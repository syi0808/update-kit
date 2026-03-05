use std::fmt;
use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use crate::errors::UpdateKitError;
use crate::types::{
    AssetInfo, Channel, CheckMode, Confidence, DelegateMode, InstallDetection, PostAction,
    UpdatePlan,
};

/// Package metadata (name and version).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
}

/// Configuration for a version source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum VersionSourceConfig {
    Github {
        owner: String,
        repo: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        token: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        api_base_url: Option<String>,
    },
    Npm {
        package_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        registry_url: Option<String>,
    },
    Jsr {
        scope: String,
        name: String,
    },
    Brew {
        cask_name: String,
    },
    Custom {
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        version_field: Option<String>,
    },
}

/// Base configuration with optional fields grouped by pipeline stage.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BaseConfig {
    // Detection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brew_cask_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npm_package_name: Option<String>,

    // Check
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<VersionSourceConfig>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_interval_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_mode: Option<CheckMode>,

    // Plan
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegate_mode: Option<DelegateMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_action: Option<PostAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_confidence: Option<Confidence>,

    // Plan (continued)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_reexec: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_pattern: Option<String>,

    // Apply
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegate_timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_checksum: Option<bool>,
}

/// Top-level configuration for UpdateKit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UpdateKitConfig {
    Explicit {
        app_name: String,
        current_version: String,
        #[serde(flatten)]
        base: BaseConfig,
    },
    Pkg {
        #[serde(skip_serializing_if = "Option::is_none")]
        app_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        current_version: Option<String>,
        pkg: PackageInfo,
        #[serde(flatten)]
        base: BaseConfig,
    },
}

/// Lifecycle hooks for the update pipeline.
pub struct Hooks {
    pub before_check:
        Option<Box<dyn Fn() -> Pin<Box<dyn Future<Output = Result<(), UpdateKitError>>>> + Send + Sync>>,
    pub before_apply: Option<
        Box<
            dyn Fn(
                    &UpdatePlan,
                )
                    -> Pin<Box<dyn Future<Output = Result<bool, UpdateKitError>> + Send>>
                + Send
                + Sync,
        >,
    >,
    pub after_apply: Option<
        Box<
            dyn Fn(
                    &crate::types::ApplyResult,
                )
                    -> Pin<Box<dyn Future<Output = Result<(), UpdateKitError>> + Send>>
                + Send
                + Sync,
        >,
    >,
    pub on_error: Option<Box<dyn Fn(&UpdateKitError) + Send + Sync>>,
}

impl Default for Hooks {
    fn default() -> Self {
        Self {
            before_check: None,
            before_apply: None,
            after_apply: None,
            on_error: None,
        }
    }
}

impl fmt::Debug for Hooks {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Hooks")
            .field("before_check", &self.before_check.as_ref().map(|_| "..."))
            .field("before_apply", &self.before_apply.as_ref().map(|_| "..."))
            .field("after_apply", &self.after_apply.as_ref().map(|_| "..."))
            .field("on_error", &self.on_error.as_ref().map(|_| "..."))
            .finish()
    }
}

/// A custom detector that can be plugged into the detection pipeline.
pub struct CustomDetector {
    pub name: String,
    pub detect: Box<
        dyn Fn() -> Pin<Box<dyn Future<Output = Result<Option<InstallDetection>, UpdateKitError>> + Send>>
            + Send
            + Sync,
    >,
}

impl fmt::Debug for CustomDetector {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CustomDetector")
            .field("name", &self.name)
            .field("detect", &"...")
            .finish()
    }
}

/// Context passed to a custom plan resolver.
pub struct PlanResolverContext<'a> {
    pub channel: &'a Channel,
    pub confidence: &'a Confidence,
    pub to_version: &'a str,
    pub config: &'a BaseConfig,
    pub assets: &'a Option<Vec<AssetInfo>>,
    pub default_plan: &'a UpdatePlan,
}

/// Type alias for a custom plan resolver function.
pub type CustomPlanResolver = Box<
    dyn Fn(PlanResolverContext<'_>) -> Pin<Box<dyn Future<Output = Result<UpdatePlan, UpdateKitError>> + Send>>
        + Send
        + Sync,
>;

/// Fully resolved and validated configuration.
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub app_name: String,
    pub current_version: semver::Version,
    pub base: BaseConfig,
}

impl TryFrom<UpdateKitConfig> for ResolvedConfig {
    type Error = UpdateKitError;

    fn try_from(config: UpdateKitConfig) -> Result<Self, Self::Error> {
        let (app_name, version_str, base) = match config {
            UpdateKitConfig::Explicit {
                app_name,
                current_version,
                base,
            } => (app_name, current_version, base),
            UpdateKitConfig::Pkg {
                app_name,
                current_version,
                pkg,
                base,
            } => {
                let name = app_name.unwrap_or(pkg.name);
                let version = current_version.unwrap_or(pkg.version);
                (name, version, base)
            }
        };

        if app_name.is_empty() {
            return Err(UpdateKitError::VersionParse(
                "app_name must not be empty".into(),
            ));
        }

        if version_str.is_empty() {
            return Err(UpdateKitError::VersionParse(
                "current_version must not be empty".into(),
            ));
        }

        let current_version = semver::Version::parse(&version_str).map_err(|e| {
            UpdateKitError::VersionParse(format!(
                "invalid semver '{}': {}",
                version_str, e
            ))
        })?;

        Ok(ResolvedConfig {
            app_name,
            current_version,
            base,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_package_info_creation() {
        let pkg = PackageInfo {
            name: "my-app".into(),
            version: "1.0.0".into(),
        };
        assert_eq!(pkg.name, "my-app");
        assert_eq!(pkg.version, "1.0.0");
    }

    #[test]
    fn test_base_config_default() {
        let config = BaseConfig::default();
        assert!(config.repository.is_none());
        assert!(config.sources.is_none());
        assert!(config.check_mode.is_none());
        assert!(config.delegate_mode.is_none());
        assert!(config.require_checksum.is_none());
    }

    #[test]
    fn test_resolved_config_explicit() {
        let config = UpdateKitConfig::Explicit {
            app_name: "my-app".into(),
            current_version: "1.2.3".into(),
            base: BaseConfig::default(),
        };
        let resolved = ResolvedConfig::try_from(config).unwrap();
        assert_eq!(resolved.app_name, "my-app");
        assert_eq!(resolved.current_version, semver::Version::new(1, 2, 3));
    }

    #[test]
    fn test_resolved_config_pkg_fallback() {
        let config = UpdateKitConfig::Pkg {
            app_name: None,
            current_version: None,
            pkg: PackageInfo {
                name: "pkg-app".into(),
                version: "0.5.0".into(),
            },
            base: BaseConfig::default(),
        };
        let resolved = ResolvedConfig::try_from(config).unwrap();
        assert_eq!(resolved.app_name, "pkg-app");
        assert_eq!(resolved.current_version, semver::Version::new(0, 5, 0));
    }

    #[test]
    fn test_resolved_config_pkg_override() {
        let config = UpdateKitConfig::Pkg {
            app_name: Some("override-name".into()),
            current_version: Some("3.0.0".into()),
            pkg: PackageInfo {
                name: "pkg-app".into(),
                version: "0.5.0".into(),
            },
            base: BaseConfig::default(),
        };
        let resolved = ResolvedConfig::try_from(config).unwrap();
        assert_eq!(resolved.app_name, "override-name");
        assert_eq!(resolved.current_version, semver::Version::new(3, 0, 0));
    }

    #[test]
    fn test_resolved_config_empty_app_name() {
        let config = UpdateKitConfig::Explicit {
            app_name: "".into(),
            current_version: "1.0.0".into(),
            base: BaseConfig::default(),
        };
        let err = ResolvedConfig::try_from(config).unwrap_err();
        assert_eq!(err.code(), "VERSION_PARSE");
        assert!(err.to_string().contains("app_name"));
    }

    #[test]
    fn test_resolved_config_empty_version() {
        let config = UpdateKitConfig::Explicit {
            app_name: "my-app".into(),
            current_version: "".into(),
            base: BaseConfig::default(),
        };
        let err = ResolvedConfig::try_from(config).unwrap_err();
        assert_eq!(err.code(), "VERSION_PARSE");
        assert!(err.to_string().contains("current_version"));
    }

    #[test]
    fn test_resolved_config_invalid_semver() {
        let config = UpdateKitConfig::Explicit {
            app_name: "my-app".into(),
            current_version: "not-a-version".into(),
            base: BaseConfig::default(),
        };
        let err = ResolvedConfig::try_from(config).unwrap_err();
        assert_eq!(err.code(), "VERSION_PARSE");
        assert!(err.to_string().contains("invalid semver"));
    }

    #[test]
    fn test_version_source_config_github_serialization() {
        let source = VersionSourceConfig::Github {
            owner: "user".into(),
            repo: "project".into(),
            token: None,
            api_base_url: None,
        };
        let json = serde_json::to_value(&source).unwrap();
        assert_eq!(json["type"], "github");
        assert_eq!(json["owner"], "user");
        assert_eq!(json["repo"], "project");
    }

    #[test]
    fn test_version_source_config_npm_serialization() {
        let source = VersionSourceConfig::Npm {
            package_name: "@scope/pkg".into(),
            registry_url: Some("https://registry.npmjs.org".into()),
        };
        let json = serde_json::to_value(&source).unwrap();
        assert_eq!(json["type"], "npm");
        assert_eq!(json["package_name"], "@scope/pkg");
        assert_eq!(json["registry_url"], "https://registry.npmjs.org");
    }

    #[test]
    fn test_version_source_config_brew_serialization() {
        let source = VersionSourceConfig::Brew {
            cask_name: "my-app".into(),
        };
        let json = serde_json::to_value(&source).unwrap();
        assert_eq!(json["type"], "brew");
        assert_eq!(json["cask_name"], "my-app");
    }

    #[test]
    fn test_version_source_config_roundtrip() {
        let source = VersionSourceConfig::Custom {
            url: "https://api.example.com/version".into(),
            version_field: Some("latest".into()),
        };
        let json = serde_json::to_string(&source).unwrap();
        let deserialized: VersionSourceConfig = serde_json::from_str(&json).unwrap();
        match deserialized {
            VersionSourceConfig::Custom { url, version_field } => {
                assert_eq!(url, "https://api.example.com/version");
                assert_eq!(version_field.as_deref(), Some("latest"));
            }
            _ => panic!("expected Custom variant"),
        }
    }

    #[test]
    fn test_hooks_debug() {
        let hooks = Hooks::default();
        let debug = format!("{:?}", hooks);
        assert!(debug.contains("Hooks"));
    }

    #[test]
    fn test_custom_detector_debug() {
        let detector = CustomDetector {
            name: "test-detector".into(),
            detect: Box::new(|| Box::pin(async { Ok(None) })),
        };
        let debug = format!("{:?}", detector);
        assert!(debug.contains("test-detector"));
    }
}
