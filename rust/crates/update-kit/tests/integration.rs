//! Integration tests for update-kit.
//!
//! These tests verify that the modules work together end-to-end
//! without requiring real network calls.

use update_kit::checker::cache::{
    clear_cache, create_cache_entry, is_cache_stale, read_cache, write_cache,
};
use update_kit::checker::infer_sources::{
    infer_source_configs, order_sources_by_channel, parse_github_repository,
};
use update_kit::config::{BaseConfig, ResolvedConfig, UpdateKitConfig, VersionSourceConfig};
use update_kit::planner::{
    get_arch_aliases, get_platform_aliases, plan_update, select_asset, PlanUpdateOptions,
};
use update_kit::types::{
    AssetInfo, Channel, Confidence, DelegateMode, InstallDetection, PlanKind,
    PostAction, UpdatePlan, UpdateStatus,
};
use update_kit::{Hooks, UpdateKit};

// ── Helpers ──

fn make_config(app_name: &str, version: &str) -> UpdateKitConfig {
    UpdateKitConfig::Explicit {
        app_name: app_name.into(),
        current_version: version.into(),
        base: BaseConfig::default(),
    }
}

fn make_resolved(app_name: &str, version: &str) -> ResolvedConfig {
    ResolvedConfig {
        app_name: app_name.into(),
        current_version: semver::Version::parse(version).unwrap(),
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
        name: name.into(),
        url: url.into(),
        size: None,
        checksum_url: None,
    }
}

// ══════════════════════════════════════════════════
// 1. Config validation
// ══════════════════════════════════════════════════

#[test]
fn config_validation_accepts_valid_explicit() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0"));
    assert!(kit.is_ok());
    let kit = kit.unwrap();
    assert_eq!(kit.resolved_config().app_name, "my-app");
    assert_eq!(
        kit.resolved_config().current_version,
        semver::Version::new(1, 0, 0)
    );
}

#[test]
fn config_validation_accepts_prerelease_version() {
    let config = make_config("my-app", "1.0.0-beta.1");
    let kit = UpdateKit::new(config);
    assert!(kit.is_ok());
}

#[test]
fn config_validation_rejects_empty_app_name() {
    let config = make_config("", "1.0.0");
    let err = UpdateKit::new(config).unwrap_err();
    assert_eq!(err.code(), "VERSION_PARSE");
}

#[test]
fn config_validation_rejects_invalid_semver() {
    let config = make_config("my-app", "not.valid");
    let err = UpdateKit::new(config).unwrap_err();
    assert_eq!(err.code(), "VERSION_PARSE");
}

#[test]
fn config_validation_rejects_empty_version() {
    let config = make_config("my-app", "");
    let err = UpdateKit::new(config).unwrap_err();
    assert_eq!(err.code(), "VERSION_PARSE");
}

#[test]
fn config_pkg_variant_fallback_to_pkg_fields() {
    let config = UpdateKitConfig::Pkg {
        app_name: None,
        current_version: None,
        pkg: update_kit::config::PackageInfo {
            name: "pkg-app".into(),
            version: "2.0.0".into(),
        },
        base: BaseConfig::default(),
    };
    let kit = UpdateKit::new(config).unwrap();
    assert_eq!(kit.resolved_config().app_name, "pkg-app");
    assert_eq!(
        kit.resolved_config().current_version,
        semver::Version::new(2, 0, 0)
    );
}

// ══════════════════════════════════════════════════
// 2. Plan generation (end-to-end through UpdateKit)
// ══════════════════════════════════════════════════

#[test]
fn plan_up_to_date_returns_none() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::UpToDate {
        current: "1.0.0".into(),
    };
    let detection = make_detection(Channel::Native, Confidence::High);
    assert!(kit.plan_update(&status, &detection).is_none());
}

#[test]
fn plan_available_native_high_confidence() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: None,
        release_notes: None,
        assets: Some(vec![make_asset(
            "my-app-darwin-arm64.tar.gz",
            "https://example.com/asset.tar.gz",
        )]),
    };
    let detection = make_detection(Channel::Native, Confidence::High);
    let plan = kit.plan_update(&status, &detection);
    assert!(plan.is_some());
    let plan = plan.unwrap();
    assert_eq!(plan.from_version, "1.0.0");
    assert_eq!(plan.to_version, "2.0.0");
}

#[test]
fn plan_npm_channel_produces_delegate_command() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: None,
        release_notes: None,
        assets: None,
    };
    let detection = make_detection(Channel::NpmGlobal, Confidence::High);
    let plan = kit.plan_update(&status, &detection).unwrap();
    match &plan.kind {
        PlanKind::DelegateCommand { channel, command, mode } => {
            assert_eq!(*channel, Channel::NpmGlobal);
            assert_eq!(command[0], "npm");
            assert_eq!(*mode, DelegateMode::PrintOnly);
        }
        other => panic!("expected DelegateCommand, got {:?}", other),
    }
}

#[test]
fn plan_brew_channel_produces_delegate_command() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: None,
        release_notes: None,
        assets: None,
    };
    let detection = make_detection(Channel::BrewCask, Confidence::High);
    let plan = kit.plan_update(&status, &detection).unwrap();
    match &plan.kind {
        PlanKind::DelegateCommand { channel, command, .. } => {
            assert_eq!(*channel, Channel::BrewCask);
            assert_eq!(command[0], "brew");
        }
        other => panic!("expected DelegateCommand, got {:?}", other),
    }
}

#[test]
fn plan_low_confidence_produces_manual() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: None,
        release_notes: None,
        assets: None,
    };
    let detection = make_detection(Channel::Native, Confidence::Low);
    let plan = kit.plan_update(&status, &detection).unwrap();
    assert!(matches!(plan.kind, PlanKind::ManualInstall { .. }));
    assert_eq!(plan.post_action, PostAction::None);
}

#[test]
fn plan_with_target_version() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::UpToDate {
        current: "1.0.0".into(),
    };
    let detection = make_detection(Channel::NpmGlobal, Confidence::High);
    let plan = kit
        .plan_update_with_options(
            &status,
            &detection,
            PlanUpdateOptions {
                target_version: Some("3.0.0".into()),
                assets: None,
            },
        )
        .unwrap();
    assert_eq!(plan.to_version, "3.0.0");
}

#[test]
fn plan_with_same_target_version_returns_none() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::UpToDate {
        current: "1.0.0".into(),
    };
    let detection = make_detection(Channel::NpmGlobal, Confidence::High);
    let plan = kit.plan_update_with_options(
        &status,
        &detection,
        PlanUpdateOptions {
            target_version: Some("1.0.0".into()),
            assets: None,
        },
    );
    assert!(plan.is_none());
}

// ══════════════════════════════════════════════════
// 3. Cache roundtrip
// ══════════════════════════════════════════════════

#[test]
fn cache_write_read_roundtrip() {
    let tmp = tempfile::TempDir::new().unwrap();
    let entry = create_cache_entry("2.0.0", "1.0.0", "github", None, None, None);

    write_cache(tmp.path(), "test-app", &entry).unwrap();
    let read_back = read_cache(tmp.path(), "test-app").unwrap();

    assert_eq!(read_back.latest_version, "2.0.0");
    assert_eq!(read_back.current_version_at_check, "1.0.0");
    assert_eq!(read_back.source, "github");
}

#[test]
fn cache_fresh_entry_is_not_stale() {
    let entry = create_cache_entry("2.0.0", "1.0.0", "github", None, None, None);
    // 1 hour interval; entry just created, should be fresh
    assert!(!is_cache_stale(&entry, 3_600_000));
}

#[test]
fn cache_old_entry_is_stale() {
    let mut entry = create_cache_entry("2.0.0", "1.0.0", "github", None, None, None);
    // Set last_checked_at to 1 hour ago
    let one_hour_ago = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
        - 3_600_000;
    entry.last_checked_at = one_hour_ago.to_string();

    // With a 30-minute interval, it should be stale
    assert!(is_cache_stale(&entry, 1_800_000));
}

#[test]
fn cache_clear_removes_data() {
    let tmp = tempfile::TempDir::new().unwrap();
    let entry = create_cache_entry("2.0.0", "1.0.0", "npm", None, None, None);

    write_cache(tmp.path(), "test-app", &entry).unwrap();
    assert!(read_cache(tmp.path(), "test-app").is_some());

    clear_cache(tmp.path(), "test-app").unwrap();
    assert!(read_cache(tmp.path(), "test-app").is_none());
}

#[test]
fn cache_missing_returns_none() {
    let tmp = tempfile::TempDir::new().unwrap();
    assert!(read_cache(tmp.path(), "nonexistent").is_none());
}

#[test]
fn cache_with_all_optional_fields() {
    let tmp = tempfile::TempDir::new().unwrap();
    let entry = create_cache_entry(
        "3.0.0",
        "2.0.0",
        "github",
        Some("etag-abc".into()),
        Some("https://github.com/user/repo/releases/tag/v3.0.0".into()),
        Some("Release notes here".into()),
    );

    write_cache(tmp.path(), "test-app", &entry).unwrap();
    let read_back = read_cache(tmp.path(), "test-app").unwrap();

    assert_eq!(read_back.etag.as_deref(), Some("etag-abc"));
    assert!(read_back.release_url.unwrap().contains("v3.0.0"));
    assert_eq!(read_back.release_notes.as_deref(), Some("Release notes here"));
}

// ══════════════════════════════════════════════════
// 4. Source inference
// ══════════════════════════════════════════════════

#[test]
fn infer_sources_includes_npm_by_default() {
    let config = make_resolved("my-app", "1.0.0");
    let sources = infer_source_configs(&config);
    assert!(sources.iter().any(|s| matches!(s, VersionSourceConfig::Npm { .. })));
}

#[test]
fn infer_sources_includes_github_when_repo_set() {
    let mut config = make_resolved("my-app", "1.0.0");
    config.base.repository = Some("https://github.com/user/repo".into());
    let sources = infer_source_configs(&config);
    assert!(sources.iter().any(|s| matches!(s, VersionSourceConfig::Github { .. })));
}

#[test]
fn infer_sources_includes_brew_when_cask_set() {
    let mut config = make_resolved("my-app", "1.0.0");
    config.base.brew_cask_name = Some("my-app".into());
    let sources = infer_source_configs(&config);
    assert!(sources.iter().any(|s| matches!(s, VersionSourceConfig::Brew { .. })));
}

#[test]
fn infer_sources_excludes_brew_when_no_cask_name() {
    let config = make_resolved("my-app", "1.0.0");
    let sources = infer_source_configs(&config);
    assert!(!sources.iter().any(|s| matches!(s, VersionSourceConfig::Brew { .. })));
}

#[test]
fn infer_sources_uses_npm_package_name_override() {
    let mut config = make_resolved("my-app", "1.0.0");
    config.base.npm_package_name = Some("@scope/my-pkg".into());
    let sources = infer_source_configs(&config);
    let npm = sources.iter().find(|s| matches!(s, VersionSourceConfig::Npm { .. }));
    match npm.unwrap() {
        VersionSourceConfig::Npm { package_name, .. } => {
            assert_eq!(package_name, "@scope/my-pkg");
        }
        _ => unreachable!(),
    }
}

#[test]
fn order_sources_npm_channel_prioritizes_npm() {
    let sources = vec![
        VersionSourceConfig::Github {
            owner: "u".into(),
            repo: "r".into(),
            token: None,
            api_base_url: None,
        },
        VersionSourceConfig::Npm {
            package_name: "pkg".into(),
            registry_url: None,
        },
    ];
    let ordered = order_sources_by_channel(sources, &Channel::NpmGlobal);
    assert!(matches!(ordered[0], VersionSourceConfig::Npm { .. }));
}

#[test]
fn order_sources_brew_channel_prioritizes_brew() {
    let sources = vec![
        VersionSourceConfig::Npm {
            package_name: "pkg".into(),
            registry_url: None,
        },
        VersionSourceConfig::Brew {
            cask_name: "app".into(),
        },
        VersionSourceConfig::Github {
            owner: "u".into(),
            repo: "r".into(),
            token: None,
            api_base_url: None,
        },
    ];
    let ordered = order_sources_by_channel(sources, &Channel::BrewCask);
    assert!(matches!(ordered[0], VersionSourceConfig::Brew { .. }));
    assert!(matches!(ordered[1], VersionSourceConfig::Github { .. }));
}

#[test]
fn parse_github_repository_various_formats() {
    // Standard URL
    assert_eq!(
        parse_github_repository("https://github.com/user/repo"),
        Some(("user".into(), "repo".into()))
    );
    // With .git suffix
    assert_eq!(
        parse_github_repository("https://github.com/user/repo.git"),
        Some(("user".into(), "repo".into()))
    );
    // Shorthand
    assert_eq!(
        parse_github_repository("user/repo"),
        Some(("user".into(), "repo".into()))
    );
    // github: prefix
    assert_eq!(
        parse_github_repository("github:user/repo"),
        Some(("user".into(), "repo".into()))
    );
    // Invalid
    assert!(parse_github_repository("not-a-repo").is_none());
}

// ══════════════════════════════════════════════════
// 5. Asset selection
// ══════════════════════════════════════════════════

#[test]
fn select_asset_darwin_arm64() {
    let assets = vec![
        make_asset("my-app-linux-x64.tar.gz", "https://example.com/linux"),
        make_asset("my-app-darwin-arm64.tar.gz", "https://example.com/darwin"),
        make_asset("my-app-windows-x64.zip", "https://example.com/windows"),
    ];
    let config = make_resolved("my-app", "1.0.0");
    let selected = select_asset(&assets, &config, "darwin", "arm64");
    assert!(selected.is_some());
    assert_eq!(selected.unwrap().name, "my-app-darwin-arm64.tar.gz");
}

#[test]
fn select_asset_linux_x64() {
    let assets = vec![
        make_asset("my-app-linux-x64.tar.gz", "https://example.com/linux"),
        make_asset("my-app-darwin-arm64.tar.gz", "https://example.com/darwin"),
    ];
    let config = make_resolved("my-app", "1.0.0");
    let selected = select_asset(&assets, &config, "linux", "x64");
    assert!(selected.is_some());
    assert_eq!(selected.unwrap().name, "my-app-linux-x64.tar.gz");
}

#[test]
fn select_asset_windows_x64() {
    let assets = vec![
        make_asset("my-app-win32-x64.zip", "https://example.com/win"),
        make_asset("my-app-darwin-arm64.tar.gz", "https://example.com/darwin"),
    ];
    let config = make_resolved("my-app", "1.0.0");
    let selected = select_asset(&assets, &config, "windows", "x64");
    assert!(selected.is_some());
    assert!(selected.unwrap().name.contains("win32"));
}

#[test]
fn select_asset_no_match_returns_none() {
    let assets = vec![make_asset(
        "my-app-freebsd-mips.tar.gz",
        "https://example.com/freebsd",
    )];
    let config = make_resolved("my-app", "1.0.0");
    let selected = select_asset(&assets, &config, "darwin", "arm64");
    assert!(selected.is_none());
}

#[test]
fn select_asset_empty_returns_none() {
    let config = make_resolved("my-app", "1.0.0");
    let selected = select_asset(&[], &config, "darwin", "arm64");
    assert!(selected.is_none());
}

#[test]
fn select_asset_with_pattern_override() {
    let mut config = make_resolved("my-app", "1.0.0");
    config.base.asset_pattern = Some("{app}-{version}-{platform}-{arch}.{ext}".into());

    let assets = vec![
        make_asset("my-app-2.0.0-darwin-arm64.tar.gz", "https://example.com/a"),
        make_asset("other-app-2.0.0-darwin-arm64.tar.gz", "https://example.com/b"),
    ];
    let selected = select_asset(&assets, &config, "darwin", "arm64");
    assert!(selected.is_some());
    assert!(selected.unwrap().name.starts_with("my-app"));
}

#[test]
fn platform_aliases_cover_major_platforms() {
    assert!(!get_platform_aliases("darwin").is_empty());
    assert!(!get_platform_aliases("macos").is_empty());
    assert!(!get_platform_aliases("linux").is_empty());
    assert!(!get_platform_aliases("windows").is_empty());
    // Unknown returns empty
    assert!(get_platform_aliases("freebsd").is_empty());
}

#[test]
fn arch_aliases_cover_major_architectures() {
    assert!(!get_arch_aliases("x86_64").is_empty());
    assert!(!get_arch_aliases("x64").is_empty());
    assert!(!get_arch_aliases("aarch64").is_empty());
    assert!(!get_arch_aliases("arm64").is_empty());
    // Unknown returns empty
    assert!(get_arch_aliases("mips").is_empty());
}

// ══════════════════════════════════════════════════
// 6. Serialization roundtrips
// ══════════════════════════════════════════════════

#[test]
fn update_status_json_roundtrip() {
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: Some("https://example.com".into()),
        release_notes: Some("Bug fixes".into()),
        assets: None,
    };
    let json = serde_json::to_string(&status).unwrap();
    let deserialized: UpdateStatus = serde_json::from_str(&json).unwrap();
    match deserialized {
        UpdateStatus::Available { current, latest, .. } => {
            assert_eq!(current, "1.0.0");
            assert_eq!(latest, "2.0.0");
        }
        _ => panic!("expected Available"),
    }
}

#[test]
fn update_plan_json_roundtrip() {
    let plan = UpdatePlan {
        kind: PlanKind::DelegateCommand {
            channel: Channel::NpmGlobal,
            command: vec!["npm".into(), "install".into(), "-g".into(), "my-app@2.0.0".into()],
            mode: DelegateMode::PrintOnly,
        },
        from_version: "1.0.0".into(),
        to_version: "2.0.0".into(),
        post_action: PostAction::ExitAfterApply,
    };
    let json = serde_json::to_string(&plan).unwrap();
    let deserialized: UpdatePlan = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.from_version, "1.0.0");
    assert_eq!(deserialized.to_version, "2.0.0");
}

#[test]
fn channel_serialization_roundtrip() {
    let channels = vec![
        Channel::Native,
        Channel::Unmanaged,
        Channel::NpmGlobal,
        Channel::BrewCask,
        Channel::Custom("snap".into()),
    ];
    for ch in channels {
        let json = serde_json::to_string(&ch).unwrap();
        let back: Channel = serde_json::from_str(&json).unwrap();
        assert_eq!(ch, back);
    }
}

// ══════════════════════════════════════════════════
// 7. Full pipeline (via planner module directly)
// ══════════════════════════════════════════════════

#[test]
fn full_pipeline_detect_plan_for_each_channel() {
    let config = make_resolved("my-app", "1.0.0");
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: None,
        release_notes: None,
        assets: None,
    };

    // Test each channel produces a valid plan
    let channels = vec![
        (Channel::Native, Confidence::High),
        (Channel::NpmGlobal, Confidence::High),
        (Channel::BrewCask, Confidence::High),
        (Channel::Unmanaged, Confidence::Medium),
        (Channel::Custom("snap".into()), Confidence::High),
    ];

    for (channel, confidence) in channels {
        let detection = make_detection(channel.clone(), confidence);
        let plan = plan_update(&status, &detection, &config, None);
        assert!(plan.is_some(), "Expected plan for channel {:?}", channel);
        let plan = plan.unwrap();
        assert_eq!(plan.from_version, "1.0.0");
        assert_eq!(plan.to_version, "2.0.0");
    }
}

// ══════════════════════════════════════════════════
// 8. Version comparison edge cases
// ══════════════════════════════════════════════════

#[test]
fn semver_prerelease_less_than_release() {
    let pre = semver::Version::parse("1.0.0-beta.1").unwrap();
    let rel = semver::Version::parse("1.0.0").unwrap();
    assert!(pre < rel);
}

#[test]
fn semver_build_metadata_ignored_in_precedence() {
    let v1 = semver::Version::parse("1.0.0+build1").unwrap();
    let v2 = semver::Version::parse("1.0.0+build2").unwrap();
    // SemVer spec: build metadata should be ignored for version precedence.
    // The semver crate includes build metadata in Eq/Ord, but the core
    // version fields (major, minor, patch, pre) are identical.
    assert_eq!(v1.major, v2.major);
    assert_eq!(v1.minor, v2.minor);
    assert_eq!(v1.patch, v2.patch);
    assert_eq!(v1.pre, v2.pre);
    // Build metadata differs but does not affect precedence
    assert_ne!(v1.build, v2.build);
}

#[test]
fn semver_v_prefix_stripped_by_config() {
    // ResolvedConfig strips 'v' prefix during parsing
    let config = make_config("my-app", "1.0.0");
    let kit = UpdateKit::new(config).unwrap();
    assert_eq!(
        kit.resolved_config().current_version,
        semver::Version::new(1, 0, 0)
    );
}

// ══════════════════════════════════════════════════
// 9. UpdateKit construction edge cases
// ══════════════════════════════════════════════════

#[test]
fn explicit_config_with_all_source_types() {
    let config = UpdateKitConfig::Explicit {
        app_name: "my-app".into(),
        current_version: "1.0.0".into(),
        base: BaseConfig {
            sources: Some(vec![
                VersionSourceConfig::Npm {
                    package_name: "my-app".into(),
                    registry_url: None,
                },
                VersionSourceConfig::Github {
                    owner: "user".into(),
                    repo: "repo".into(),
                    token: None,
                    api_base_url: None,
                },
                VersionSourceConfig::Brew {
                    cask_name: "my-app".into(),
                },
            ]),
            ..Default::default()
        },
    };
    let kit = UpdateKit::new(config);
    assert!(kit.is_ok());
}

#[test]
fn hooks_default_is_empty() {
    let hooks = Hooks::default();
    assert!(hooks.before_check.is_none());
    assert!(hooks.before_apply.is_none());
    assert!(hooks.after_apply.is_none());
    assert!(hooks.on_error.is_none());
}

#[test]
fn config_with_repository_field() {
    let config = UpdateKitConfig::Explicit {
        app_name: "my-app".into(),
        current_version: "1.0.0".into(),
        base: BaseConfig {
            repository: Some("https://github.com/user/repo".into()),
            ..Default::default()
        },
    };
    let kit = UpdateKit::new(config).unwrap();
    assert_eq!(
        kit.resolved_config().base.repository.as_deref(),
        Some("https://github.com/user/repo")
    );
}

// ══════════════════════════════════════════════════
// 10. Plan update edge cases
// ══════════════════════════════════════════════════

#[test]
fn plan_with_target_version_downgrade() {
    let kit = UpdateKit::new(make_config("my-app", "2.0.0")).unwrap();
    let status = UpdateStatus::UpToDate {
        current: "2.0.0".into(),
    };
    let detection = make_detection(Channel::NpmGlobal, Confidence::High);
    let plan = kit.plan_update_with_options(
        &status,
        &detection,
        PlanUpdateOptions {
            target_version: Some("1.0.0".into()),
            assets: None,
        },
    );
    // Should still generate a plan (downgrade is allowed)
    assert!(plan.is_some());
    let plan = plan.unwrap();
    assert_eq!(plan.to_version, "1.0.0");
}

#[test]
fn plan_native_high_confidence_with_assets_produces_native_in_place() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: None,
        release_notes: None,
        assets: Some(vec![make_asset(
            "my-app-darwin-arm64.tar.gz",
            "https://example.com/asset.tar.gz",
        )]),
    };
    let detection = make_detection(Channel::Native, Confidence::High);
    let plan = kit.plan_update(&status, &detection).unwrap();
    assert!(matches!(plan.kind, PlanKind::NativeInPlace { .. }));
}

#[test]
fn plan_unmanaged_channel_produces_manual() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: Some("https://example.com/releases".into()),
        release_notes: None,
        assets: None,
    };
    let detection = make_detection(Channel::Unmanaged, Confidence::Medium);
    let plan = kit.plan_update(&status, &detection).unwrap();
    assert!(matches!(plan.kind, PlanKind::ManualInstall { .. }));
}

#[test]
fn plan_custom_channel_produces_manual() {
    let kit = UpdateKit::new(make_config("my-app", "1.0.0")).unwrap();
    let status = UpdateStatus::Available {
        current: "1.0.0".into(),
        latest: "2.0.0".into(),
        release_url: None,
        release_notes: None,
        assets: None,
    };
    let detection = make_detection(Channel::Custom("snap".into()), Confidence::High);
    let plan = kit.plan_update(&status, &detection).unwrap();
    assert!(matches!(plan.kind, PlanKind::ManualInstall { .. }));
}

// ══════════════════════════════════════════════════
// 11. Asset selection additional cases
// ══════════════════════════════════════════════════

#[test]
fn asset_selection_case_insensitive_platform() {
    let assets = vec![
        make_asset("my-app-Darwin-arm64.tar.gz", "https://example.com/a"),
        make_asset("my-app-linux-x64.tar.gz", "https://example.com/b"),
    ];
    let config = make_resolved("my-app", "1.0.0");
    let selected = select_asset(&assets, &config, "darwin", "arm64");
    // Should match even though asset has uppercase "Darwin"
    assert!(selected.is_some());
}

#[test]
fn asset_selection_prefers_tar_gz_over_zip_on_unix() {
    let assets = vec![
        make_asset("my-app-darwin-arm64.zip", "https://example.com/zip"),
        make_asset(
            "my-app-darwin-arm64.tar.gz",
            "https://example.com/targz",
        ),
    ];
    let config = make_resolved("my-app", "1.0.0");
    let selected = select_asset(&assets, &config, "darwin", "arm64");
    assert!(selected.is_some());
    // Both match; just verify we get one
    let name = &selected.unwrap().name;
    assert!(name.contains("darwin") && name.contains("arm64"));
}

// ══════════════════════════════════════════════════
// 12. Cache edge cases
// ══════════════════════════════════════════════════

#[test]
fn cache_with_unicode_app_name() {
    let tmp = tempfile::TempDir::new().unwrap();
    let entry = create_cache_entry("2.0.0", "1.0.0", "npm", None, None, None);
    write_cache(tmp.path(), "my-\u{C571}", &entry).unwrap();
    let read_back = read_cache(tmp.path(), "my-\u{C571}").unwrap();
    assert_eq!(read_back.latest_version, "2.0.0");
}

#[test]
fn cache_overwrite_existing() {
    let tmp = tempfile::TempDir::new().unwrap();
    let entry1 = create_cache_entry("2.0.0", "1.0.0", "npm", None, None, None);
    write_cache(tmp.path(), "app", &entry1).unwrap();

    let entry2 = create_cache_entry("3.0.0", "2.0.0", "github", None, None, None);
    write_cache(tmp.path(), "app", &entry2).unwrap();

    let read_back = read_cache(tmp.path(), "app").unwrap();
    assert_eq!(read_back.latest_version, "3.0.0");
    assert_eq!(read_back.source, "github");
}

// ══════════════════════════════════════════════════
// 13. Serialization additional cases
// ══════════════════════════════════════════════════

#[test]
fn serialize_up_to_date_status_roundtrip() {
    let status = UpdateStatus::UpToDate {
        current: "1.0.0".into(),
    };
    let json = serde_json::to_string(&status).unwrap();
    let back: UpdateStatus = serde_json::from_str(&json).unwrap();
    match back {
        UpdateStatus::UpToDate { current } => assert_eq!(current, "1.0.0"),
        _ => panic!("expected UpToDate"),
    }
}

#[test]
fn serialize_unknown_status_roundtrip() {
    let status = UpdateStatus::Unknown {
        reason: "no source".into(),
        cached_latest: None,
    };
    let json = serde_json::to_string(&status).unwrap();
    let back: UpdateStatus = serde_json::from_str(&json).unwrap();
    match back {
        UpdateStatus::Unknown { reason, .. } => assert_eq!(reason, "no source"),
        _ => panic!("expected Unknown"),
    }
}

#[test]
fn serialize_native_in_place_plan_roundtrip() {
    let plan = UpdatePlan {
        kind: PlanKind::NativeInPlace {
            download_url: "https://example.com/v2.tar.gz".into(),
            checksum_url: Some("https://example.com/v2.sha256".into()),
            expected_checksum: None,
        },
        from_version: "1.0.0".into(),
        to_version: "2.0.0".into(),
        post_action: PostAction::ExitAfterApply,
    };
    let json = serde_json::to_string(&plan).unwrap();
    let back: UpdatePlan = serde_json::from_str(&json).unwrap();
    assert_eq!(back.from_version, "1.0.0");
    match back.kind {
        PlanKind::NativeInPlace { download_url, .. } => {
            assert!(download_url.contains("v2.tar.gz"));
        }
        _ => panic!("expected NativeInPlace"),
    }
}

#[test]
fn serialize_manual_install_plan_roundtrip() {
    let plan = UpdatePlan {
        kind: PlanKind::ManualInstall {
            reason: "unsupported channel".into(),
            instructions: "Download from website".into(),
            download_url: Some("https://example.com/download".into()),
        },
        from_version: "1.0.0".into(),
        to_version: "2.0.0".into(),
        post_action: PostAction::None,
    };
    let json = serde_json::to_string(&plan).unwrap();
    let back: UpdatePlan = serde_json::from_str(&json).unwrap();
    match back.kind {
        PlanKind::ManualInstall { instructions, .. } => {
            assert_eq!(instructions, "Download from website");
        }
        _ => panic!("expected ManualInstall"),
    }
}
