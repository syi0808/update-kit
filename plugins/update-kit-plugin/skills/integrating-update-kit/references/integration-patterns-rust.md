# update-kit Rust Integration Patterns

## Table of Contents

- [Pattern A: Startup Notification](#pattern-a-startup-notification)
- [Pattern B: Dedicated Update Command](#pattern-b-dedicated-update-command)
- [Pattern C: Manual Pipeline](#pattern-c-manual-pipeline)
- [Pattern D: With Hooks](#pattern-d-with-hooks)
- [Pattern E: Version Listing & Switching](#pattern-e-version-listing--switching)
- [Pattern F: Custom Detectors](#pattern-f-custom-detectors)
- [Pattern G: Combining Patterns](#pattern-g-combining-patterns)

---

## Pattern A: Startup Notification

**Best for**: Any CLI app. Zero latency impact. Shows a banner if an update is available.
**Method**: `check_and_notify()` (non-blocking, cache-based)

```rust
use update_kit::{UpdateKit, UpdateKitConfig, BaseConfig, VersionSourceConfig};

#[tokio::main]
async fn main() {
    let kit = UpdateKit::new(UpdateKitConfig::Explicit {
        app_name: "my-cli".into(),
        current_version: env!("CARGO_PKG_VERSION").into(),
        base: BaseConfig {
            sources: Some(vec![VersionSourceConfig::Github {
                owner: "myorg".into(),
                repo: "my-cli".into(),
                token: None,
                api_base_url: None,
            }]),
            ..Default::default()
        },
    }).expect("invalid config");

    // Non-blocking: reads cache, spawns background refresh if stale
    if let Ok(Some(banner)) = kit.check_and_notify().await {
        eprintln!("{}", banner);  // stderr to avoid interfering with piped output
    }

    // ... rest of CLI logic
}
```

---

## Pattern B: Dedicated Update Command

**Best for**: CLIs with an explicit `my-cli update` subcommand.
**Method**: `auto_update()` with `DelegateMode::Execute`

```rust
use update_kit::{
    UpdateKit, UpdateKitConfig, BaseConfig, VersionSourceConfig,
    ApplyResult, DelegateMode,
};
use update_kit::applier::types::ApplyOptions;
use update_kit::types::ApplyProgress;

async fn handle_update_command() {
    let kit = UpdateKit::new(UpdateKitConfig::Explicit {
        app_name: "my-cli".into(),
        current_version: env!("CARGO_PKG_VERSION").into(),
        base: BaseConfig {
            sources: Some(vec![VersionSourceConfig::Npm {
                package_name: "my-cli".into(),
                registry_url: None,
            }]),
            delegate_mode: Some(DelegateMode::Execute),
            ..Default::default()
        },
    }).expect("invalid config");

    let result = kit.auto_update(Some(ApplyOptions {
        on_progress: Some(Box::new(|p| {
            match p {
                ApplyProgress::Downloading { bytes_downloaded, total_bytes } => {
                    if let Some(total) = total_bytes {
                        let pct = (bytes_downloaded as f64 / total as f64 * 100.0) as u32;
                        eprint!("\rDownloading... {}%", pct);
                    }
                }
                ApplyProgress::Done => eprintln!("\nDone."),
                _ => {}
            }
        })),
        skip_checksum: false,
    })).await;

    match result {
        ApplyResult::Success { from_version, to_version, .. } => {
            println!("Updated from {} to {}", from_version, to_version);
        }
        ApplyResult::UpToDate { current } => {
            println!("Already on latest version ({})", current);
        }
        ApplyResult::NeedsRestart { message } => {
            println!("{}", message);
        }
        ApplyResult::Failed { error, .. } => {
            eprintln!("Update failed: {}", error);
            std::process::exit(1);
        }
    }
}
```

---

## Pattern C: Manual Pipeline

**Best for**: Apps needing custom logic between pipeline stages.
**Methods**: `detect_install()` -> `check_update()` -> `plan_update()` -> `apply_update()`

```rust
use update_kit::{
    UpdateKit, UpdateKitConfig, BaseConfig, VersionSourceConfig,
    UpdateStatus, CheckMode,
};

async fn manual_update(kit: &UpdateKit) -> anyhow::Result<()> {
    let detection = kit.detect_install().await?;
    println!("Installed via: {:?} ({:?})", detection.channel, detection.confidence);

    let status = kit.check_update(CheckMode::Blocking).await?;
    match &status {
        UpdateStatus::Available { current, latest, .. } => {
            println!("Update available: {} -> {}", current, latest);
        }
        UpdateStatus::UpToDate { current } => {
            println!("Already up to date ({})", current);
            return Ok(());
        }
        UpdateStatus::Unknown { reason, .. } => {
            println!("Could not check: {}", reason);
            return Ok(());
        }
    }

    let plan = match kit.plan_update(&status, &detection) {
        Some(p) => p,
        None => {
            println!("No applicable update plan.");
            return Ok(());
        }
    };

    println!("Strategy: {:?}", plan.kind);

    let result = kit.apply_update(&plan, None).await;
    match result {
        update_kit::ApplyResult::Success { to_version, .. } => {
            println!("Updated to {}", to_version);
        }
        _ => {}
    }

    Ok(())
}
```

---

## Pattern D: With Hooks

**Best for**: Apps needing telemetry, CI gating, or fine-grained control.

```rust
use update_kit::{UpdateKit, UpdateKitConfig, BaseConfig, VersionSourceConfig, Hooks};

fn create_kit_with_hooks() -> Result<UpdateKit, update_kit::UpdateKitError> {
    let config = UpdateKitConfig::Explicit {
        app_name: "my-cli".into(),
        current_version: env!("CARGO_PKG_VERSION").into(),
        base: BaseConfig {
            sources: Some(vec![VersionSourceConfig::Github {
                owner: "myorg".into(),
                repo: "my-cli".into(),
                token: None,
                api_base_url: None,
            }]),
            ..Default::default()
        },
    };

    let hooks = Hooks {
        before_check: Some(Box::new(|| {
            Box::pin(async {
                // Skip update checks in CI environments
                if std::env::var("CI").is_ok() {
                    return Err(update_kit::UpdateKitError::ApplyFailed("CI skip".into()));
                }
                Ok(())
            })
        })),
        before_apply: Some(Box::new(|plan| {
            let to_version = plan.to_version.clone();
            let from_version = plan.from_version.clone();
            Box::pin(async move {
                // Only allow same-major updates automatically
                let to_major = to_version.split('.').next().unwrap_or("0");
                let from_major = from_version.split('.').next().unwrap_or("0");
                Ok(to_major == from_major)
            })
        })),
        on_error: Some(Box::new(|err| {
            eprintln!("Update error [{}]: {}", err.code(), err);
        })),
        ..Default::default()
    };

    UpdateKit::with_hooks(config, hooks, None)
}
```

---

## Pattern E: Version Listing & Switching

**Best for**: CLIs with `my-cli versions` and `my-cli switch <version>` subcommands.
**Methods**: `list_versions()` + `switch_version()`

```rust
use update_kit::{UpdateKit, ApplyResult};
use update_kit::checker::sources::{FetchVersionsOptions, VersionListResult};

async fn handle_versions_command(kit: &UpdateKit) {
    let result = kit.list_versions(Some(FetchVersionsOptions {
        limit: Some(10),
        cursor: None,
    })).await;

    match result {
        Ok(VersionListResult::Success { versions, .. }) => {
            for v in &versions {
                let date = v.published_at.as_deref().unwrap_or("");
                println!("  {} {}", v.version, date);
            }
        }
        Ok(VersionListResult::Error { reason }) => {
            eprintln!("Error: {}", reason);
        }
        Err(e) => {
            eprintln!("Failed to list versions: {}", e);
        }
    }
}

async fn handle_switch_command(kit: &UpdateKit, target_version: &str) {
    let result = kit.switch_version(target_version, None).await;

    match result {
        ApplyResult::Success { from_version, to_version, .. } => {
            println!("Switched from {} to {}", from_version, to_version);
        }
        ApplyResult::UpToDate { current } => {
            println!("Already at version {}", current);
        }
        ApplyResult::Failed { error, .. } => {
            eprintln!("Switch failed: {}", error);
            std::process::exit(1);
        }
        _ => {}
    }
}
```

---

## Pattern F: Custom Detectors

**Best for**: Apps with non-standard install channels.

```rust
use update_kit::{
    UpdateKit, UpdateKitConfig, BaseConfig, VersionSourceConfig,
    InstallDetection, Channel, Confidence, Evidence,
};
use update_kit::config::CustomDetector;

fn create_kit_with_custom_detector() -> Result<UpdateKit, update_kit::UpdateKitError> {
    let _detector = CustomDetector {
        name: "docker".into(),
        detect: Box::new(|| {
            Box::pin(async {
                if std::env::var("RUNNING_IN_DOCKER").is_ok() {
                    Ok(Some(InstallDetection {
                        channel: Channel::Custom("docker".into()),
                        confidence: Confidence::High,
                        evidence: vec![Evidence {
                            source: "env".into(),
                            detail: "RUNNING_IN_DOCKER is set".into(),
                        }],
                    }))
                } else {
                    Ok(None) // pass to next detector
                }
            })
        }),
    };

    // Pass custom detectors via DetectionConfig (advanced usage)
    // For most cases, use the standard UpdateKit::new with repository/sources config
    UpdateKit::new(UpdateKitConfig::Explicit {
        app_name: "my-cli".into(),
        current_version: env!("CARGO_PKG_VERSION").into(),
        base: BaseConfig {
            sources: Some(vec![VersionSourceConfig::Github {
                owner: "myorg".into(),
                repo: "my-cli".into(),
                token: None,
                api_base_url: None,
            }]),
            ..Default::default()
        },
    })
}
```

---

## Pattern G: Combining Patterns

Patterns compose naturally. Common combinations:

**Startup notification + update command** (Pattern A + B):
- Add `check_and_notify()` to the main entry point for passive notification
- Add a dedicated `update` subcommand with `auto_update()` for active updates

```rust
#[tokio::main]
async fn main() {
    let kit = create_kit();

    match std::env::args().nth(1).as_deref() {
        Some("update") => {
            let result = kit.auto_update(None).await;
            // handle result...
        }
        _ => {
            if let Ok(Some(banner)) = kit.check_and_notify().await {
                eprintln!("{}", banner);
            }
            // normal CLI logic...
        }
    }
}
```

**Startup notification + version management** (Pattern A + E):
- Add `check_and_notify()` to the main entry point for passive notification
- Add `versions` and `switch` subcommands for full version control

**Any pattern + hooks** (Pattern A/B/C + D):
- Add hooks via `UpdateKit::with_hooks()` for CI skipping or telemetry
