//! Planner module — determines the update strategy based on install channel,
//! confidence level, and available assets.
//!
//! This is a **pure** module: no I/O, no side effects.

use regex::Regex;

use crate::checker::normalize_version;
use crate::config::ResolvedConfig;
use crate::types::{
    AssetInfo, Channel, Confidence, DelegateMode, InstallDetection, PlanKind, PostAction,
    UpdatePlan, UpdateStatus,
};

/// Options for [`plan_update`].
#[derive(Debug, Clone, Default)]
pub struct PlanUpdateOptions {
    /// Override the target version. When set, plans for this version instead of `status.latest`.
    pub target_version: Option<String>,
    /// Release assets for native-in-place strategy.
    pub assets: Option<Vec<AssetInfo>>,
}

/// Create an update plan based on version status, installation detection, and configuration.
///
/// Returns `None` if no update is needed (status is not `Available` and no `target_version`
/// specified, or the current and target versions are identical).
pub fn plan_update(
    status: &UpdateStatus,
    detection: &InstallDetection,
    config: &ResolvedConfig,
    options: Option<PlanUpdateOptions>,
) -> Option<UpdatePlan> {
    let opts = options.unwrap_or_default();
    let PlanUpdateOptions {
        target_version,
        assets,
    } = opts;

    if let Some(ref target) = target_version {
        // Explicit target version (upgrade or downgrade)
        let current = match status {
            UpdateStatus::Available { current, .. } => current.clone(),
            UpdateStatus::UpToDate { current } => current.clone(),
            UpdateStatus::Unknown { .. } => config.current_version.to_string(),
        };

        let normalized_current = normalize_version(&current);
        let normalized_target = normalize_version(target);
        if let (Some(nc), Some(nt)) = (&normalized_current, &normalized_target) {
            if nc == nt {
                return None;
            }
        }

        let channel = &detection.channel;
        let confidence = detection.confidence;
        let kind = resolve_plan_kind(channel, confidence, target, config, assets.as_deref());
        let post_action = resolve_post_action(&kind, confidence, config);

        return Some(UpdatePlan {
            kind,
            from_version: current,
            to_version: target.clone(),
            post_action,
        });
    }

    // Without explicit target, only proceed for Available status
    let (from_version, to_version, status_assets) = match status {
        UpdateStatus::Available {
            current,
            latest,
            assets: sa,
            ..
        } => (current.clone(), latest.clone(), sa.clone()),
        _ => return None,
    };

    let channel = &detection.channel;
    let confidence = detection.confidence;

    // Merge assets: explicit options take precedence over status assets
    let effective_assets = assets.or(status_assets);

    let kind = resolve_plan_kind(
        channel,
        confidence,
        &to_version,
        config,
        effective_assets.as_deref(),
    );
    let post_action = resolve_post_action(&kind, confidence, config);

    Some(UpdatePlan {
        kind,
        from_version,
        to_version,
        post_action,
    })
}

// ──────────────────────────────────────────────
// Channel dispatch
// ──────────────────────────────────────────────

fn resolve_plan_kind(
    channel: &Channel,
    confidence: Confidence,
    to_version: &str,
    config: &ResolvedConfig,
    assets: Option<&[AssetInfo]>,
) -> PlanKind {
    match channel {
        Channel::Native => resolve_native_channel(confidence, config, assets),
        Channel::Unmanaged => resolve_unmanaged_channel(confidence, config, assets),
        Channel::NpmGlobal => resolve_npm_channel(confidence, to_version, config),
        Channel::BrewCask => resolve_brew_channel(confidence, config),
        Channel::Custom(name) => PlanKind::ManualInstall {
            reason: format!("Unknown install channel: {}", name),
            instructions: "Please update manually using your original installation method."
                .to_string(),
            download_url: None,
        },
    }
}

// ──────────────────────────────────────────────
// Channel-specific resolvers
// ──────────────────────────────────────────────

fn resolve_native_channel(
    confidence: Confidence,
    config: &ResolvedConfig,
    assets: Option<&[AssetInfo]>,
) -> PlanKind {
    if confidence == Confidence::Low {
        return PlanKind::ManualInstall {
            reason: "Low confidence in native channel detection.".to_string(),
            instructions: "Please download and install the update manually.".to_string(),
            download_url: assets.and_then(|a| a.first().map(|x| x.url.clone())),
        };
    }

    resolve_native_in_place(assets, config)
}

fn resolve_unmanaged_channel(
    confidence: Confidence,
    config: &ResolvedConfig,
    assets: Option<&[AssetInfo]>,
) -> PlanKind {
    if confidence == Confidence::None {
        return PlanKind::ManualInstall {
            reason: "Unable to detect installation method.".to_string(),
            instructions: "Please reinstall using your preferred installation method.".to_string(),
            download_url: None,
        };
    }

    resolve_native_in_place(assets, config)
}

fn resolve_npm_channel(
    confidence: Confidence,
    to_version: &str,
    config: &ResolvedConfig,
) -> PlanKind {
    let package_name = config
        .base
        .npm_package_name
        .as_deref()
        .unwrap_or(&config.app_name);

    if confidence == Confidence::Low {
        return PlanKind::ManualInstall {
            reason: "Low confidence in npm-global detection.".to_string(),
            instructions: format!("Please update manually: npm install -g {}", package_name),
            download_url: None,
        };
    }

    let mode = config
        .base
        .delegate_mode
        .unwrap_or(DelegateMode::PrintOnly);

    PlanKind::DelegateCommand {
        channel: Channel::NpmGlobal,
        command: vec![
            "npm".to_string(),
            "install".to_string(),
            "-g".to_string(),
            format!("{}@{}", package_name, to_version),
        ],
        mode,
    }
}

fn resolve_brew_channel(confidence: Confidence, config: &ResolvedConfig) -> PlanKind {
    let cask_name = config
        .base
        .brew_cask_name
        .as_deref()
        .unwrap_or(&config.app_name);

    if confidence == Confidence::Low {
        return PlanKind::ManualInstall {
            reason: "Low confidence in brew-cask detection.".to_string(),
            instructions: format!("Please update manually: brew upgrade --cask {}", cask_name),
            download_url: None,
        };
    }

    let mode = config
        .base
        .delegate_mode
        .unwrap_or(DelegateMode::PrintOnly);

    PlanKind::DelegateCommand {
        channel: Channel::BrewCask,
        command: vec![
            "brew".to_string(),
            "upgrade".to_string(),
            "--cask".to_string(),
            cask_name.to_string(),
        ],
        mode,
    }
}

// ──────────────────────────────────────────────
// Shared native-in-place resolution
// ──────────────────────────────────────────────

fn resolve_native_in_place(assets: Option<&[AssetInfo]>, config: &ResolvedConfig) -> PlanKind {
    let assets = match assets {
        Some(a) if !a.is_empty() => a,
        _ => {
            return PlanKind::ManualInstall {
                reason: "No release assets available.".to_string(),
                instructions:
                    "Please check the project website for installation instructions.".to_string(),
                download_url: None,
            };
        }
    };

    let platform = current_platform();
    let arch = current_arch();

    match select_asset(assets, config, platform, arch) {
        Some(selected) => PlanKind::NativeInPlace {
            download_url: selected.url.clone(),
            checksum_url: selected.checksum_url.clone(),
            expected_checksum: None,
        },
        None => PlanKind::ManualInstall {
            reason: format!("No compatible asset found for {}/{}.", platform, arch),
            instructions:
                "Please download and install the update manually for your platform.".to_string(),
            download_url: assets.first().map(|a| a.url.clone()),
        },
    }
}

// ──────────────────────────────────────────────
// PostAction resolution
// ──────────────────────────────────────────────

fn resolve_post_action(
    kind: &PlanKind,
    confidence: Confidence,
    config: &ResolvedConfig,
) -> PostAction {
    match kind {
        PlanKind::NativeInPlace { .. } => {
            if confidence == Confidence::High
                && config.base.allow_reexec.unwrap_or(false)
            {
                PostAction::Reexec
            } else {
                PostAction::SuggestRestart
            }
        }
        PlanKind::DelegateCommand { .. } => PostAction::ExitAfterApply,
        PlanKind::ManualInstall { .. } => PostAction::None,
    }
}

// ──────────────────────────────────────────────
// Asset selection
// ──────────────────────────────────────────────

/// Select the appropriate asset for the current platform/architecture.
///
/// Matching priority:
/// 1. User-defined `asset_pattern` with placeholder expansion
/// 2. Auto-matching by platform/architecture keywords
pub fn select_asset<'a>(
    assets: &'a [AssetInfo],
    config: &ResolvedConfig,
    platform: &str,
    arch: &str,
) -> Option<&'a AssetInfo> {
    if assets.is_empty() {
        return None;
    }

    // Priority 1: user-defined placeholder pattern
    if let Some(ref pattern) = config.base.asset_pattern {
        if let Ok(regex) = expand_asset_pattern(pattern, config, platform, arch) {
            if let Some(matched) = assets.iter().find(|a| regex.is_match(&a.name)) {
                return Some(matched);
            }
        }
    }

    // Priority 2: auto-match by platform + arch keywords
    auto_match_asset(assets, platform, arch)
}

/// Expand a placeholder-based asset pattern into a [`Regex`].
///
/// Supported placeholders:
/// - `{app}` — `config.app_name` (literal)
/// - `{version}` — any semver-like string
/// - `{target}` — platform-arch (e.g. "darwin-arm64")
/// - `{platform}` — platform aliases joined with `|`
/// - `{arch}` — arch aliases joined with `|`
/// - `{ext}` — common archive extensions
pub fn expand_asset_pattern(
    pattern: &str,
    config: &ResolvedConfig,
    platform: &str,
    arch: &str,
) -> Result<Regex, String> {
    if pattern.len() > 256 {
        return Err(format!(
            "Asset pattern is too long ({} chars, max 256)",
            pattern.len()
        ));
    }

    let platform_group = get_platform_aliases(platform).join("|");
    let arch_group = get_arch_aliases(arch).join("|");
    let target_group = format!("({})[_-]({})", platform_group, arch_group);

    // Escape regex special chars, but preserve our placeholder braces
    let mut escaped = String::with_capacity(pattern.len() * 2);
    for ch in pattern.chars() {
        match ch {
            '.' | '+' | '?' | '^' | '$' | '(' | ')' | '|' | '[' | ']' | '\\' | '*' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            // Don't escape braces — they are used for placeholders
            _ => escaped.push(ch),
        }
    }

    let expanded = escaped
        .replace("{app}", &escape_regex(&config.app_name))
        .replace("{version}", "[\\w.+-]+")
        .replace("{target}", &target_group)
        .replace("{platform}", &format!("({})", platform_group))
        .replace("{arch}", &format!("({})", arch_group))
        .replace(
            "{ext}",
            "(tar\\.gz|tgz|zip|gz|dmg|exe|msi|deb|rpm|pkg)",
        );

    let full = format!("(?i)^{}$", expanded);
    Regex::new(&full).map_err(|e| format!("Invalid asset pattern \"{}\": {}", pattern, e))
}

fn auto_match_asset<'a>(
    assets: &'a [AssetInfo],
    platform: &str,
    arch: &str,
) -> Option<&'a AssetInfo> {
    let platform_aliases = get_platform_aliases(platform);
    let arch_aliases = get_arch_aliases(arch);

    assets.iter().find(|asset| {
        let name = asset.name.to_lowercase();
        let matches_platform = platform_aliases.iter().any(|alias| name.contains(alias));
        let matches_arch = arch_aliases.iter().any(|alias| name.contains(alias));
        matches_platform && matches_arch
    })
}

/// Get platform aliases for asset matching.
///
/// Accepts both Rust (`std::env::consts::OS`) and Node.js platform names.
pub fn get_platform_aliases(platform: &str) -> Vec<&'static str> {
    match platform {
        // Rust OS name
        "macos" | "darwin" => vec!["darwin", "macos", "mac", "osx", "apple"],
        "linux" => vec!["linux"],
        "windows" | "win32" => vec!["win32", "windows", "win64"],
        _ => vec![], // Return empty for unknown; caller can handle
    }
}

/// Get architecture aliases for asset matching.
///
/// Accepts both Rust (`std::env::consts::ARCH`) and Node.js arch names.
pub fn get_arch_aliases(arch: &str) -> Vec<&'static str> {
    match arch {
        // Rust arch name
        "x86_64" | "x64" => vec!["x64", "x86_64", "amd64"],
        "aarch64" | "arm64" => vec!["arm64", "aarch64"],
        "x86" | "ia32" | "i386" | "i686" => vec!["ia32", "x86", "i386", "i686"],
        _ => vec![],
    }
}

/// Return the current platform string using `std::env::consts::OS`.
fn current_platform() -> &'static str {
    std::env::consts::OS
}

/// Return the current architecture string using `std::env::consts::ARCH`.
fn current_arch() -> &'static str {
    std::env::consts::ARCH
}

fn escape_regex(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        match ch {
            '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']'
            | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::BaseConfig;

    fn make_config() -> ResolvedConfig {
        ResolvedConfig {
            app_name: "my-app".to_string(),
            current_version: semver::Version::new(1, 0, 0),
            base: BaseConfig::default(),
        }
    }

    fn make_detection(channel: Channel, confidence: Confidence) -> InstallDetection {
        InstallDetection {
            channel,
            confidence,
            evidence: vec![],
        }
    }

    fn make_asset(name: &str, url: &str) -> AssetInfo {
        AssetInfo {
            name: name.to_string(),
            url: url.to_string(),
            size: None,
            checksum_url: None,
        }
    }

    // ── plan_update tests ──

    #[test]
    fn up_to_date_returns_none() {
        let status = UpdateStatus::UpToDate {
            current: "1.0.0".into(),
        };
        let detection = make_detection(Channel::Native, Confidence::High);
        let config = make_config();

        let plan = plan_update(&status, &detection, &config, None);
        assert!(plan.is_none());
    }

    #[test]
    fn native_high_confidence_gives_native_in_place() {
        let assets = vec![make_asset(
            "my-app-darwin-arm64.tar.gz",
            "https://example.com/my-app-darwin-arm64.tar.gz",
        )];
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: Some(assets),
        };
        let detection = make_detection(Channel::Native, Confidence::High);
        let config = make_config();

        let plan = plan_update(&status, &detection, &config, None).unwrap();
        assert_eq!(plan.from_version, "1.0.0");
        assert_eq!(plan.to_version, "2.0.0");
        match &plan.kind {
            PlanKind::NativeInPlace { download_url, .. } => {
                assert!(download_url.contains("darwin-arm64"));
            }
            other => panic!("expected NativeInPlace, got {:?}", other),
        }
    }

    #[test]
    fn npm_channel_gives_delegate() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::NpmGlobal, Confidence::High);
        let config = make_config();

        let plan = plan_update(&status, &detection, &config, None).unwrap();
        match &plan.kind {
            PlanKind::DelegateCommand {
                channel, command, ..
            } => {
                assert_eq!(*channel, Channel::NpmGlobal);
                assert_eq!(command[0], "npm");
                assert!(command[3].contains("2.0.0"));
            }
            other => panic!("expected DelegateCommand, got {:?}", other),
        }
        assert_eq!(plan.post_action, PostAction::ExitAfterApply);
    }

    #[test]
    fn brew_channel_gives_delegate() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::BrewCask, Confidence::High);
        let config = make_config();

        let plan = plan_update(&status, &detection, &config, None).unwrap();
        match &plan.kind {
            PlanKind::DelegateCommand {
                channel, command, ..
            } => {
                assert_eq!(*channel, Channel::BrewCask);
                assert_eq!(command[0], "brew");
                assert_eq!(command[2], "--cask");
            }
            other => panic!("expected DelegateCommand, got {:?}", other),
        }
        assert_eq!(plan.post_action, PostAction::ExitAfterApply);
    }

    #[test]
    fn low_confidence_gives_manual() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::Native, Confidence::Low);
        let config = make_config();

        let plan = plan_update(&status, &detection, &config, None).unwrap();
        match &plan.kind {
            PlanKind::ManualInstall { reason, .. } => {
                assert!(reason.contains("Low confidence"));
            }
            other => panic!("expected ManualInstall, got {:?}", other),
        }
        assert_eq!(plan.post_action, PostAction::None);
    }

    #[test]
    fn no_assets_gives_manual() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::Native, Confidence::High);
        let config = make_config();

        let plan = plan_update(&status, &detection, &config, None).unwrap();
        match &plan.kind {
            PlanKind::ManualInstall { reason, .. } => {
                assert!(reason.contains("No release assets"));
            }
            other => panic!("expected ManualInstall, got {:?}", other),
        }
    }

    // ── alias tests ──

    #[test]
    fn platform_aliases_darwin() {
        let aliases = get_platform_aliases("darwin");
        assert!(aliases.contains(&"darwin"));
        assert!(aliases.contains(&"macos"));
        assert!(aliases.contains(&"mac"));
        assert!(aliases.contains(&"osx"));
        assert!(aliases.contains(&"apple"));

        // Rust OS name "macos" should also work
        let aliases2 = get_platform_aliases("macos");
        assert_eq!(aliases, aliases2);
    }

    #[test]
    fn arch_aliases_x64() {
        let aliases = get_arch_aliases("x64");
        assert!(aliases.contains(&"x64"));
        assert!(aliases.contains(&"x86_64"));
        assert!(aliases.contains(&"amd64"));

        // Rust arch name "x86_64" should also work
        let aliases2 = get_arch_aliases("x86_64");
        assert_eq!(aliases, aliases2);
    }

    // ── asset selection tests ──

    #[test]
    fn select_asset_matches_platform_arch() {
        let assets = vec![
            make_asset("my-app-linux-x64.tar.gz", "https://example.com/linux-x64"),
            make_asset(
                "my-app-darwin-arm64.tar.gz",
                "https://example.com/darwin-arm64",
            ),
            make_asset(
                "my-app-windows-x64.zip",
                "https://example.com/windows-x64",
            ),
        ];
        let config = make_config();

        let selected = select_asset(&assets, &config, "darwin", "arm64").unwrap();
        assert_eq!(selected.name, "my-app-darwin-arm64.tar.gz");

        let selected = select_asset(&assets, &config, "linux", "x64").unwrap();
        assert_eq!(selected.name, "my-app-linux-x64.tar.gz");

        let selected = select_asset(&assets, &config, "windows", "x64").unwrap();
        assert_eq!(selected.name, "my-app-windows-x64.zip");
    }

    // ── expand_asset_pattern tests ──

    #[test]
    fn expand_asset_pattern_basic() {
        let config = make_config();
        let regex = expand_asset_pattern("{app}-{version}-{platform}-{arch}.{ext}", &config, "darwin", "arm64").unwrap();

        assert!(regex.is_match("my-app-1.2.3-darwin-arm64.tar.gz"));
        assert!(regex.is_match("my-app-2.0.0-macos-aarch64.zip"));
        assert!(!regex.is_match("other-app-1.0.0-darwin-arm64.tar.gz"));
    }

    #[test]
    fn target_version_same_returns_none() {
        let status = UpdateStatus::UpToDate {
            current: "1.0.0".into(),
        };
        let detection = make_detection(Channel::Native, Confidence::High);
        let config = make_config();

        let plan = plan_update(
            &status,
            &detection,
            &config,
            Some(PlanUpdateOptions {
                target_version: Some("1.0.0".into()),
                assets: None,
            }),
        );
        assert!(plan.is_none());
    }

    #[test]
    fn target_version_different_returns_plan() {
        let status = UpdateStatus::UpToDate {
            current: "1.0.0".into(),
        };
        let detection = make_detection(Channel::NpmGlobal, Confidence::High);
        let config = make_config();

        let plan = plan_update(
            &status,
            &detection,
            &config,
            Some(PlanUpdateOptions {
                target_version: Some("2.0.0".into()),
                assets: None,
            }),
        )
        .unwrap();
        assert_eq!(plan.from_version, "1.0.0");
        assert_eq!(plan.to_version, "2.0.0");
    }

    #[test]
    fn unmanaged_none_confidence_gives_manual() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::Unmanaged, Confidence::None);
        let config = make_config();

        let plan = plan_update(&status, &detection, &config, None).unwrap();
        match &plan.kind {
            PlanKind::ManualInstall { reason, .. } => {
                assert!(reason.contains("Unable to detect"));
            }
            other => panic!("expected ManualInstall, got {:?}", other),
        }
    }

    #[test]
    fn native_high_with_reexec_gives_reexec_post_action() {
        let assets = vec![make_asset(
            "my-app-darwin-arm64.tar.gz",
            "https://example.com/asset",
        )];
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: Some(assets),
        };
        let detection = make_detection(Channel::Native, Confidence::High);
        let mut config = make_config();
        config.base.allow_reexec = Some(true);

        let plan = plan_update(&status, &detection, &config, None).unwrap();
        // This will only be Reexec if the asset matched the current platform;
        // force platform matching by using select_asset directly
        match &plan.kind {
            PlanKind::NativeInPlace { .. } => {
                assert_eq!(plan.post_action, PostAction::Reexec);
            }
            PlanKind::ManualInstall { .. } => {
                // Asset didn't match this platform, post_action is None
                assert_eq!(plan.post_action, PostAction::None);
            }
            other => panic!("unexpected kind: {:?}", other),
        }
    }

    #[test]
    fn custom_channel_gives_manual() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::Custom("snap".into()), Confidence::High);
        let config = make_config();

        let plan = plan_update(&status, &detection, &config, None).unwrap();
        match &plan.kind {
            PlanKind::ManualInstall { reason, .. } => {
                assert!(reason.contains("snap"));
            }
            other => panic!("expected ManualInstall, got {:?}", other),
        }
    }
}
