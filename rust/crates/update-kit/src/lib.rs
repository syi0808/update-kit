//! Channel-aware self-update toolkit for CLI applications.
//!
//! `update-kit` detects how an application was installed and manages self-updates
//! through a pipeline: **Detection -> Check -> Plan -> Apply**.
//!
//! The main entry point is [`UpdateKit`], which orchestrates the full pipeline.

pub mod applier;
pub mod checker;
pub mod config;
pub mod constants;
pub mod detection;
pub mod errors;
pub mod planner;
pub mod platform;
pub mod types;
pub mod utils;
pub mod ux;

// Re-export key types at the crate root for convenience.
pub use config::{BaseConfig, Hooks, ResolvedConfig, UpdateKitConfig, VersionSourceConfig};
pub use errors::UpdateKitError;
pub use types::{
    ApplyResult, AssetInfo, Channel, CheckMode, Confidence, DelegateMode, Evidence,
    InstallDetection, PlanKind, PostAction, UpdatePlan, UpdateStatus,
};

use std::path::PathBuf;

use crate::applier::delegate::{apply_delegate_update, DelegateApplyOptions};
use crate::applier::native::apply_native_update;
use crate::applier::types::ApplyOptions;
use crate::checker::infer_sources::{infer_source_configs, order_sources_by_channel};
use crate::checker::sources::{
    create_version_source, FetchVersionsOptions, VersionListResult, VersionSource,
};
use crate::checker::{check_update, CheckUpdateOptions};
use crate::detection::{detect_install, DetectionConfig};
use crate::planner::{plan_update, PlanUpdateOptions};
use crate::platform::paths::get_default_cache_dir;
use crate::ux::banner::render_banner;

/// The main orchestrator for the update-kit pipeline.
///
/// Coordinates detection, checking, planning, and applying updates
/// through a channel-based policy engine.
pub struct UpdateKit {
    config: ResolvedConfig,
    sources: Option<Vec<Box<dyn VersionSource>>>,
    hooks: Hooks,
    executable_path: Option<String>,
}

impl std::fmt::Debug for UpdateKit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UpdateKit")
            .field("config", &self.config)
            .field("sources", &self.sources.as_ref().map(|s| s.len()))
            .field("hooks", &self.hooks)
            .field("executable_path", &self.executable_path)
            .finish()
    }
}

impl UpdateKit {
    /// Create a new UpdateKit instance from the given configuration.
    ///
    /// Resolves and validates the config (including semver parsing).
    /// If explicit sources are provided in config, they are materialized here.
    pub fn new(config: UpdateKitConfig) -> Result<Self, UpdateKitError> {
        Self::with_hooks(config, Hooks::default(), None)
    }

    /// Create a new UpdateKit instance with lifecycle hooks and an optional executable path.
    pub fn with_hooks(
        config: UpdateKitConfig,
        hooks: Hooks,
        executable_path: Option<String>,
    ) -> Result<Self, UpdateKitError> {
        let resolved = ResolvedConfig::try_from(config)?;

        // Pre-build sources if explicitly configured
        let sources = resolved.base.sources.as_ref().map(|source_configs| {
            source_configs
                .iter()
                .cloned()
                .map(create_version_source)
                .collect::<Vec<_>>()
        });

        Ok(Self {
            config: resolved,
            sources,
            hooks,
            executable_path,
        })
    }

    /// Detect how the application was installed.
    pub async fn detect_install(&self) -> Result<InstallDetection, UpdateKitError> {
        let exec_path = self.resolve_exec_path()?;
        let detection_config = DetectionConfig {
            app_name: &self.config.app_name,
            brew_cask_name: self.config.base.brew_cask_name.as_deref(),
            custom_detectors: &[],
            receipt_dir: None,
        };
        Ok(detect_install(&exec_path, &detection_config).await)
    }

    /// Check for available updates.
    ///
    /// In `Blocking` mode, fetches from sources immediately.
    /// In `NonBlocking` mode, reads cache and spawns background check if stale.
    pub async fn check_update(&self, mode: CheckMode) -> Result<UpdateStatus, UpdateKitError> {
        // Run before_check hook
        if let Some(ref hook) = self.hooks.before_check {
            hook().await?;
        }

        let sources = self.get_effective_sources(None);
        let cache_dir = self.get_cache_dir();

        let options = CheckUpdateOptions {
            app_name: self.config.app_name.clone(),
            current_version: self.config.current_version.to_string(),
            sources,
            cache_dir,
            check_interval: self.config.base.check_interval_ms,
        };

        check_update(&options, mode).await
    }

    /// Create an update plan based on the current status and detection result.
    pub fn plan_update(
        &self,
        status: &UpdateStatus,
        detection: &InstallDetection,
    ) -> Option<UpdatePlan> {
        plan_update(status, detection, &self.config, None)
    }

    /// Create an update plan with additional options (e.g., target version).
    pub fn plan_update_with_options(
        &self,
        status: &UpdateStatus,
        detection: &InstallDetection,
        options: PlanUpdateOptions,
    ) -> Option<UpdatePlan> {
        plan_update(status, detection, &self.config, Some(options))
    }

    /// Apply an update plan.
    ///
    /// Dispatches to native, delegate, or manual handler based on the plan kind.
    /// Runs before_apply and after_apply hooks, and on_error on failure.
    pub async fn apply_update(
        &self,
        plan: &UpdatePlan,
        options: Option<ApplyOptions>,
    ) -> ApplyResult {
        // Run before_apply hook
        if let Some(ref hook) = self.hooks.before_apply {
            match hook(plan).await {
                Ok(false) => {
                    return ApplyResult::Failed {
                        error: Box::new(UpdateKitError::ApplyFailed(
                            "Aborted by before_apply hook".into(),
                        )),
                        rollback_succeeded: false,
                    };
                }
                Err(e) => {
                    if let Some(ref on_err) = self.hooks.on_error {
                        on_err(&e);
                    }
                    return ApplyResult::Failed {
                        error: Box::new(e),
                        rollback_succeeded: false,
                    };
                }
                Ok(true) => {}
            }
        }

        let result = match &plan.kind {
            PlanKind::NativeInPlace { .. } => {
                let target_path = match self.resolve_exec_path() {
                    Ok(p) => p,
                    Err(e) => {
                        return ApplyResult::Failed {
                            error: Box::new(e),
                            rollback_succeeded: false,
                        };
                    }
                };
                apply_native_update(plan, &target_path, options.as_ref()).await
            }
            PlanKind::DelegateCommand { mode, .. } => {
                let delegate_opts = DelegateApplyOptions {
                    mode: Some(*mode),
                    timeout_ms: self.config.base.delegate_timeout_ms,
                    on_progress: None,
                };
                apply_delegate_update(plan, Some(delegate_opts)).await
            }
            PlanKind::ManualInstall {
                instructions,
                download_url,
                ..
            } => {
                let msg = if let Some(url) = download_url {
                    format!("{}\nDownload: {}", instructions, url)
                } else {
                    instructions.clone()
                };
                ApplyResult::NeedsRestart { message: msg }
            }
        };

        // Run after_apply hook
        if let Some(ref hook) = self.hooks.after_apply {
            let _ = hook(&result).await;
        }

        // Run on_error hook if failed
        if let ApplyResult::Failed { ref error, .. } = result {
            if let Some(ref on_err) = self.hooks.on_error {
                on_err(error);
            }
        }

        result
    }

    /// One-liner for app startup: detect, non-blocking check, render banner.
    ///
    /// Returns `Ok(Some(banner))` if an update is available, `Ok(None)` if
    /// up-to-date or check is still pending, or quietly returns `Ok(None)` on
    /// any error.
    pub async fn check_and_notify(&self) -> Result<Option<String>, UpdateKitError> {
        let detection = match self.detect_install().await {
            Ok(d) => d,
            Err(_) => return Ok(None),
        };

        let status = match self.check_update(CheckMode::NonBlocking).await {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };

        Ok(render_banner(&status, &detection))
    }

    /// Full auto-update pipeline: detect -> blocking check -> plan -> apply.
    ///
    /// Never panics. All errors are wrapped in `ApplyResult::Failed`.
    pub async fn auto_update(&self, options: Option<ApplyOptions>) -> ApplyResult {
        let detection = match self.detect_install().await {
            Ok(d) => d,
            Err(e) => {
                return ApplyResult::Failed {
                    error: Box::new(e),
                    rollback_succeeded: false,
                }
            }
        };

        let status = match self.check_update(CheckMode::Blocking).await {
            Ok(s) => s,
            Err(e) => {
                return ApplyResult::Failed {
                    error: Box::new(e),
                    rollback_succeeded: false,
                }
            }
        };

        let plan = match self.plan_update(&status, &detection) {
            Some(p) => p,
            None => {
                let current = match &status {
                    UpdateStatus::UpToDate { current } => current.clone(),
                    UpdateStatus::Available { current, .. } => current.clone(),
                    UpdateStatus::Unknown { .. } => self.config.current_version.to_string(),
                };
                return ApplyResult::UpToDate { current };
            }
        };

        self.apply_update(&plan, options).await
    }

    /// Fetch a list of available versions from the first source that supports it.
    pub async fn list_versions(
        &self,
        options: Option<FetchVersionsOptions>,
    ) -> Result<VersionListResult, UpdateKitError> {
        let sources = self.get_effective_sources(None);
        let opts = options.unwrap_or_default();

        for source in &sources {
            match source.fetch_versions(opts.clone()).await {
                Ok(result) => return Ok(result),
                Err(UpdateKitError::UnsupportedOperation(_)) => continue,
                Err(e) => return Err(e),
            }
        }

        Err(UpdateKitError::UnsupportedOperation(
            "No source supports fetch_versions".into(),
        ))
    }

    /// Switch to a specific version: detect -> create synthetic status -> plan -> apply.
    pub async fn switch_version(
        &self,
        target: &str,
        options: Option<ApplyOptions>,
    ) -> ApplyResult {
        let detection = match self.detect_install().await {
            Ok(d) => d,
            Err(e) => {
                return ApplyResult::Failed {
                    error: Box::new(e),
                    rollback_succeeded: false,
                }
            }
        };

        // Create a synthetic Available status for the target version
        let current = self.config.current_version.to_string();
        let status = UpdateStatus::Available {
            current: current.clone(),
            latest: target.to_string(),
            release_url: None,
            release_notes: None,
            assets: None,
        };

        let plan_opts = PlanUpdateOptions {
            target_version: Some(target.to_string()),
            assets: None,
        };

        let plan = match self.plan_update_with_options(&status, &detection, plan_opts) {
            Some(p) => p,
            None => {
                return ApplyResult::UpToDate { current };
            }
        };

        self.apply_update(&plan, options).await
    }

    /// Return a reference to the resolved configuration.
    pub fn resolved_config(&self) -> &ResolvedConfig {
        &self.config
    }

    // ── Private helpers ──

    fn resolve_exec_path(&self) -> Result<String, UpdateKitError> {
        if let Some(ref path) = self.executable_path {
            return Ok(path.clone());
        }
        std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| {
                UpdateKitError::DetectionFailed(format!("Cannot determine executable path: {}", e))
            })
    }

    fn get_cache_dir(&self) -> PathBuf {
        get_default_cache_dir().join("update-kit")
    }

    /// Get effective sources: explicit if configured, otherwise inferred and
    /// optionally ordered by channel.
    fn get_effective_sources(
        &self,
        channel: Option<&crate::types::Channel>,
    ) -> Vec<Box<dyn VersionSource>> {
        if let Some(ref _sources) = self.sources {
            // Rebuild from config since trait objects can't be cloned
            if let Some(ref source_configs) = self.config.base.sources {
                return source_configs
                    .iter()
                    .cloned()
                    .map(create_version_source)
                    .collect();
            }
            // Fallback: this shouldn't happen since self.sources is only Some when
            // config has explicit sources, but handle gracefully
            return vec![];
        }

        // Infer sources from config
        let mut configs = infer_source_configs(&self.config);
        if let Some(ch) = channel {
            configs = order_sources_by_channel(configs, ch);
        }
        configs.into_iter().map(create_version_source).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::BaseConfig;

    #[test]
    fn create_with_explicit_config_succeeds() {
        let config = UpdateKitConfig::Explicit {
            app_name: "my-app".into(),
            current_version: "1.0.0".into(),
            base: BaseConfig::default(),
        };
        let kit = UpdateKit::new(config);
        assert!(kit.is_ok());
        let kit = kit.unwrap();
        assert_eq!(kit.resolved_config().app_name, "my-app");
        assert_eq!(
            kit.resolved_config().current_version,
            semver::Version::new(1, 0, 0)
        );
    }

    #[test]
    fn create_with_invalid_semver_fails() {
        let config = UpdateKitConfig::Explicit {
            app_name: "my-app".into(),
            current_version: "not-valid".into(),
            base: BaseConfig::default(),
        };
        let err = UpdateKit::new(config).unwrap_err();
        assert_eq!(err.code(), "VERSION_PARSE");
    }

    #[test]
    fn create_with_empty_app_name_fails() {
        let config = UpdateKitConfig::Explicit {
            app_name: "".into(),
            current_version: "1.0.0".into(),
            base: BaseConfig::default(),
        };
        let err = UpdateKit::new(config).unwrap_err();
        assert_eq!(err.code(), "VERSION_PARSE");
    }

    #[test]
    fn plan_update_delegates_to_planner() {
        let config = UpdateKitConfig::Explicit {
            app_name: "my-app".into(),
            current_version: "1.0.0".into(),
            base: BaseConfig::default(),
        };
        let kit = UpdateKit::new(config).unwrap();

        // UpToDate should produce None
        let status = UpdateStatus::UpToDate {
            current: "1.0.0".into(),
        };
        let detection = InstallDetection {
            channel: crate::types::Channel::Native,
            confidence: crate::types::Confidence::High,
            evidence: vec![],
        };
        assert!(kit.plan_update(&status, &detection).is_none());

        // Available should produce Some
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let plan = kit.plan_update(&status, &detection);
        assert!(plan.is_some());
        let plan = plan.unwrap();
        assert_eq!(plan.from_version, "1.0.0");
        assert_eq!(plan.to_version, "2.0.0");
    }

    #[test]
    fn resolved_config_returns_reference() {
        let config = UpdateKitConfig::Explicit {
            app_name: "test-app".into(),
            current_version: "0.1.0".into(),
            base: BaseConfig {
                repository: Some("https://github.com/user/repo".into()),
                ..Default::default()
            },
        };
        let kit = UpdateKit::new(config).unwrap();
        assert_eq!(kit.resolved_config().app_name, "test-app");
        assert_eq!(
            kit.resolved_config().base.repository.as_deref(),
            Some("https://github.com/user/repo")
        );
    }

    #[test]
    fn create_with_explicit_sources() {
        let config = UpdateKitConfig::Explicit {
            app_name: "my-app".into(),
            current_version: "1.0.0".into(),
            base: BaseConfig {
                sources: Some(vec![crate::config::VersionSourceConfig::Npm {
                    package_name: "my-app".into(),
                    registry_url: None,
                }]),
                ..Default::default()
            },
        };
        let kit = UpdateKit::new(config).unwrap();
        // sources field should be Some since we provided explicit sources
        assert!(kit.sources.is_some());
    }
}
