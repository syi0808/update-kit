use clap::{Parser, Subcommand};
use update_kit::checker::cache;
use update_kit::config::{BaseConfig, UpdateKitConfig};
use update_kit::platform::paths::get_default_cache_dir;
use update_kit::types::{CheckMode, UpdateStatus};
use update_kit::UpdateKit;

/// Channel-aware self-update toolkit for CLI applications.
#[derive(Parser)]
#[command(name = "update-kit", version, about)]
struct Cli {
    /// Output as JSON
    #[arg(long, global = true)]
    json: bool,

    /// Application name
    #[arg(long, global = true)]
    app_name: Option<String>,

    /// Current version
    #[arg(long, global = true)]
    current_version: Option<String>,

    /// GitHub repository (owner/repo or URL)
    #[arg(long, global = true)]
    repository: Option<String>,

    /// Brew cask name
    #[arg(long, global = true)]
    brew_cask_name: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

/// Available subcommands.
#[derive(Subcommand)]
enum Commands {
    /// Detect installation channel
    Detect,
    /// Check for updates
    Check {
        /// Check mode: blocking or non-blocking
        #[arg(long, default_value = "blocking")]
        mode: String,
    },
    /// Show update plan
    Plan,
    /// Apply update
    Apply {
        /// Skip checksum verification
        #[arg(long)]
        skip_checksum: bool,
    },
    /// Cache operations
    Cache {
        #[command(subcommand)]
        action: CacheAction,
    },
    /// Run diagnostic checks
    Doctor,
}

/// Cache subcommands.
#[derive(Subcommand)]
enum CacheAction {
    /// Show cached version info
    Show,
    /// Clear cached version info
    Clear,
}

fn require_config(cli: &Cli) -> Result<UpdateKit, String> {
    let app_name = cli
        .app_name
        .clone()
        .ok_or("--app-name is required")?;
    let current_version = cli
        .current_version
        .clone()
        .ok_or("--current-version is required")?;

    let config = UpdateKitConfig::Explicit {
        app_name,
        current_version,
        base: BaseConfig {
            repository: cli.repository.clone(),
            brew_cask_name: cli.brew_cask_name.clone(),
            ..Default::default()
        },
    };

    UpdateKit::new(config).map_err(|e| format!("Config error: {}", e))
}

fn cache_dir_for(_cli: &Cli) -> std::path::PathBuf {
    get_default_cache_dir().join("update-kit")
}

fn app_name_or_err(cli: &Cli) -> Result<String, String> {
    cli.app_name
        .clone()
        .ok_or_else(|| "--app-name is required".to_string())
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let result = run(&cli).await;
    match result {
        Ok(()) => {}
        Err(msg) => {
            if cli.json {
                let err = serde_json::json!({ "error": msg });
                eprintln!("{}", serde_json::to_string_pretty(&err).unwrap());
            } else {
                eprintln!("Error: {}", msg);
            }
            std::process::exit(1);
        }
    }
}

async fn run(cli: &Cli) -> Result<(), String> {
    match &cli.command {
        Commands::Detect => cmd_detect(cli).await,
        Commands::Check { mode } => cmd_check(cli, mode).await,
        Commands::Plan => cmd_plan(cli).await,
        Commands::Apply { skip_checksum } => cmd_apply(cli, *skip_checksum).await,
        Commands::Cache { action } => cmd_cache(cli, action),
        Commands::Doctor => cmd_doctor(cli).await,
    }
}

async fn cmd_detect(cli: &Cli) -> Result<(), String> {
    let kit = require_config(cli)?;
    let detection = kit
        .detect_install()
        .await
        .map_err(|e| format!("Detection failed: {}", e))?;

    if cli.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&detection).map_err(|e| e.to_string())?
        );
    } else {
        println!("Channel:    {:?}", detection.channel);
        println!("Confidence: {:?}", detection.confidence);
        for ev in &detection.evidence {
            println!("  [{}] {}", ev.source, ev.detail);
        }
    }
    Ok(())
}

async fn cmd_check(cli: &Cli, mode_str: &str) -> Result<(), String> {
    let kit = require_config(cli)?;
    let mode = match mode_str {
        "blocking" => CheckMode::Blocking,
        "non-blocking" => CheckMode::NonBlocking,
        other => return Err(format!("Invalid check mode '{}'. Use 'blocking' or 'non-blocking'.", other)),
    };

    let status = kit
        .check_update(mode)
        .await
        .map_err(|e| format!("Check failed: {}", e))?;

    if cli.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&status).map_err(|e| e.to_string())?
        );
    } else {
        match &status {
            UpdateStatus::Available {
                current,
                latest,
                release_url,
                ..
            } => {
                println!("Update available: {} -> {}", current, latest);
                if let Some(url) = release_url {
                    println!("Release: {}", url);
                }
            }
            UpdateStatus::UpToDate { current } => {
                println!("Up to date ({})", current);
            }
            UpdateStatus::Unknown { reason, cached_latest } => {
                println!("Unknown: {}", reason);
                if let Some(cached) = cached_latest {
                    println!("Cached latest: {}", cached);
                }
            }
        }
    }
    Ok(())
}

async fn cmd_plan(cli: &Cli) -> Result<(), String> {
    let kit = require_config(cli)?;

    let detection = kit
        .detect_install()
        .await
        .map_err(|e| format!("Detection failed: {}", e))?;

    let status = kit
        .check_update(CheckMode::Blocking)
        .await
        .map_err(|e| format!("Check failed: {}", e))?;

    let plan = kit.plan_update(&status, &detection);

    if cli.json {
        match &plan {
            Some(p) => println!(
                "{}",
                serde_json::to_string_pretty(p).map_err(|e| e.to_string())?
            ),
            None => println!("null"),
        }
    } else {
        match plan {
            Some(p) => {
                println!("Plan: {} -> {}", p.from_version, p.to_version);
                println!("Strategy: {:?}", p.kind);
                println!("Post action: {:?}", p.post_action);
            }
            None => {
                println!("No update plan needed.");
            }
        }
    }
    Ok(())
}

async fn cmd_apply(cli: &Cli, skip_checksum: bool) -> Result<(), String> {
    let kit = require_config(cli)?;

    let options = if skip_checksum {
        Some(update_kit::applier::types::ApplyOptions {
            skip_checksum: true,
            on_progress: None,
        })
    } else {
        None
    };

    let result = kit.auto_update(options).await;

    if cli.json {
        // Serialize what we can
        let output = match &result {
            update_kit::types::ApplyResult::Success {
                from_version,
                to_version,
                post_action,
            } => serde_json::json!({
                "status": "success",
                "from_version": from_version,
                "to_version": to_version,
                "post_action": format!("{:?}", post_action),
            }),
            update_kit::types::ApplyResult::UpToDate { current } => serde_json::json!({
                "status": "up-to-date",
                "current": current,
            }),
            update_kit::types::ApplyResult::NeedsRestart { message } => serde_json::json!({
                "status": "needs-restart",
                "message": message,
            }),
            update_kit::types::ApplyResult::Failed {
                error,
                rollback_succeeded,
            } => serde_json::json!({
                "status": "failed",
                "error": error.to_string(),
                "error_code": error.code(),
                "rollback_succeeded": rollback_succeeded,
            }),
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&output).map_err(|e| e.to_string())?
        );
    } else {
        match &result {
            update_kit::types::ApplyResult::Success {
                from_version,
                to_version,
                ..
            } => {
                println!("Updated successfully: {} -> {}", from_version, to_version);
            }
            update_kit::types::ApplyResult::UpToDate { current } => {
                println!("Already up to date ({})", current);
            }
            update_kit::types::ApplyResult::NeedsRestart { message } => {
                println!("{}", message);
            }
            update_kit::types::ApplyResult::Failed {
                error,
                rollback_succeeded,
            } => {
                eprintln!("Update failed: {}", error);
                if *rollback_succeeded {
                    eprintln!("Rollback succeeded.");
                }
                std::process::exit(1);
            }
        }
    }
    Ok(())
}

fn cmd_cache(cli: &Cli, action: &CacheAction) -> Result<(), String> {
    let app_name = app_name_or_err(cli)?;
    let cache_dir = cache_dir_for(cli);

    match action {
        CacheAction::Show => {
            let entry = cache::read_cache(&cache_dir, &app_name);
            match entry {
                Some(e) => {
                    if cli.json {
                        println!(
                            "{}",
                            serde_json::to_string_pretty(&e).map_err(|e| e.to_string())?
                        );
                    } else {
                        println!("Latest version: {}", e.latest_version);
                        println!("Checked at:     {}", e.current_version_at_check);
                        println!("Last checked:   {}", e.last_checked_at);
                        println!("Source:         {}", e.source);
                        if let Some(etag) = &e.etag {
                            println!("ETag:           {}", etag);
                        }
                        if let Some(url) = &e.release_url {
                            println!("Release URL:    {}", url);
                        }
                    }
                }
                None => {
                    if cli.json {
                        println!("null");
                    } else {
                        println!("No cached data for '{}'.", app_name);
                    }
                }
            }
        }
        CacheAction::Clear => {
            cache::clear_cache(&cache_dir, &app_name)
                .map_err(|e| format!("Failed to clear cache: {}", e))?;
            if cli.json {
                println!(r#"{{"cleared": true}}"#);
            } else {
                println!("Cache cleared for '{}'.", app_name);
            }
        }
    }
    Ok(())
}

async fn cmd_doctor(cli: &Cli) -> Result<(), String> {
    println!("update-kit doctor");
    println!("=================");
    println!();

    // Check 1: Config validation
    print!("Config validation... ");
    match (cli.app_name.as_ref(), cli.current_version.as_ref()) {
        (Some(name), Some(version)) => {
            let config = UpdateKitConfig::Explicit {
                app_name: name.clone(),
                current_version: version.clone(),
                base: BaseConfig {
                    repository: cli.repository.clone(),
                    brew_cask_name: cli.brew_cask_name.clone(),
                    ..Default::default()
                },
            };
            match UpdateKit::new(config) {
                Ok(_) => println!("OK"),
                Err(e) => println!("FAIL - {}", e),
            }
        }
        _ => println!("SKIP (--app-name and --current-version not provided)"),
    }

    // Check 2: Cache directory
    print!("Cache directory...   ");
    let cache_dir = get_default_cache_dir().join("update-kit");
    if cache_dir.exists() {
        println!("OK ({})", cache_dir.display());
    } else {
        println!("Not found ({})", cache_dir.display());
    }

    // Check 3: Detection (if config provided)
    if let Ok(kit) = require_config(cli) {
        print!("Detection...         ");
        match kit.detect_install().await {
            Ok(det) => println!("OK ({:?}, {:?})", det.channel, det.confidence),
            Err(e) => println!("FAIL - {}", e),
        }
    }

    // Check 4: Source inference
    if let (Some(name), Some(version)) = (cli.app_name.as_ref(), cli.current_version.as_ref()) {
        print!("Source inference...   ");
        let config = UpdateKitConfig::Explicit {
            app_name: name.clone(),
            current_version: version.clone(),
            base: BaseConfig {
                repository: cli.repository.clone(),
                brew_cask_name: cli.brew_cask_name.clone(),
                ..Default::default()
            },
        };
        if let Ok(resolved) = update_kit::config::ResolvedConfig::try_from(config) {
            let sources = update_kit::checker::infer_sources::infer_source_configs(&resolved);
            println!(
                "OK ({} source(s): {})",
                sources.len(),
                sources
                    .iter()
                    .map(|s| format!("{:?}", s).split('{').next().unwrap_or("?").trim().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        } else {
            println!("FAIL");
        }
    }

    println!();
    println!("Done.");
    Ok(())
}
