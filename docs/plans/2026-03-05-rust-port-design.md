# update-kit Rust Port Design

## Overview

Port update-kit to Rust as a crate for Rust CLI developers to integrate self-update functionality into their applications. Full 1:1 feature parity with the TypeScript version.

## Decisions

| Decision | Choice |
|----------|--------|
| Target users | Rust CLI developers (crate) |
| Scope | Full 1:1 port |
| Repository | Monorepo (`rust/` directory) |
| Async runtime | tokio + reqwest |
| Background check | std::process::Command spawn (same as TS) |
| Approach | Direct port with Rust-idiomatic patterns |

## Project Structure

```
rust/
  Cargo.toml                    # workspace root
  crates/
    update-kit/                 # main library crate
      Cargo.toml
      src/
        lib.rs                  # public API re-exports
        config.rs               # UpdateKitConfig, ResolvedConfig, builder
        types.rs                # UpdateStatus, ApplyResult, PlanKind enums
        errors.rs               # UpdateKitError enum (thiserror)
        constants.rs            # timeout constants
        detection/
          mod.rs                # detect_install()
          receipt.rs
          brew.rs
          npm.rs
          heuristics.rs
        checker/
          mod.rs                # check_update()
          cache.rs
          background.rs         # background process spawn
          infer_sources.rs
          sources/
            mod.rs              # VersionSource trait + factory
            github.rs
            npm_registry.rs
            jsr.rs
            brew_api.rs
            custom_manifest.rs
        planner/
          mod.rs                # plan_update() pure function
        applier/
          mod.rs
          native.rs             # download + verify + extract + replace
          delegate.rs           # spawn package manager commands
          verify.rs             # SHA-256 checksum
        platform/
          mod.rs
          replace.rs            # atomic_replace()
          paths.rs              # cache_dir, config_dir
        utils/
          mod.rs
          http.rs               # reqwest wrapper with timeout/proxy
          fs.rs
          security.rs
        ux/
          mod.rs
          banner.rs
          progress.rs
          colors.rs
    update-kit-cli/             # CLI binary crate
      Cargo.toml
      src/
        main.rs                 # clap-based CLI
```

## Type Mappings

### TS → Rust Pattern Mapping

| TypeScript Pattern | Rust Pattern |
|---|---|
| Discriminated union (`kind`/`type` field) | `enum` with variants |
| Optional fields | `Option<T>` |
| `UpdateKitError` class + error codes | `thiserror` enum |
| Config interfaces | Builder pattern struct |
| `VersionSource` interface | `#[async_trait] trait VersionSource` |
| Hooks (callback functions) | `Box<dyn Fn(...) + Send + Sync>` |
| `Promise<T>` | `async fn -> Result<T, E>` |

### Core Types

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Channel {
    Native,
    NpmGlobal,
    BrewCask,
    Unmanaged,
    Custom(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Confidence {
    None,
    Low,
    Medium,
    High,
}

pub struct InstallDetection {
    pub channel: Channel,
    pub confidence: Confidence,
    pub evidence: Vec<Evidence>,
}

pub enum UpdateStatus {
    Available {
        current: String,
        latest: String,
        release_url: Option<String>,
        release_notes: Option<String>,
        assets: Option<Vec<AssetInfo>>,
    },
    UpToDate { current: String },
    Unknown { reason: String, cached_latest: Option<String> },
}

pub enum PlanKind {
    NativeInPlace {
        download_url: String,
        checksum_url: Option<String>,
        expected_checksum: Option<String>,
    },
    DelegateCommand {
        channel: Channel,
        command: Vec<String>,
        mode: DelegateMode,
    },
    ManualInstall {
        reason: String,
        instructions: String,
        download_url: Option<String>,
    },
}

pub struct UpdatePlan {
    pub kind: PlanKind,
    pub from_version: String,
    pub to_version: String,
    pub post_action: PostAction,
}

pub enum ApplyResult {
    Success { from_version: String, to_version: String, post_action: PostAction },
    UpToDate { current: String },
    NeedsRestart { message: String },
    Failed { error: UpdateKitError, rollback_succeeded: bool },
}

pub enum ApplyProgress {
    Downloading { bytes_downloaded: u64, total_bytes: Option<u64> },
    Verifying,
    Extracting,
    Replacing,
    Executing { output: String, stream: OutputStream },
    Done,
}
```

### VersionSource Trait

```rust
#[async_trait]
pub trait VersionSource: Send + Sync {
    fn name(&self) -> &str;
    async fn fetch_latest(&self, options: FetchOptions) -> VersionSourceResult;
    async fn fetch_versions(&self, options: FetchVersionsOptions) -> Result<VersionListResult, UpdateKitError> {
        Err(UpdateKitError::UnsupportedOperation("fetch_versions not supported".into()))
    }
}
```

### Public API

```rust
pub struct UpdateKit { config: ResolvedUpdateKitConfig }

impl UpdateKit {
    pub fn new(config: UpdateKitConfig) -> Result<Self, UpdateKitError>;

    pub async fn detect_install(&self) -> Result<InstallDetection, UpdateKitError>;
    pub async fn check_update(&self, mode: CheckMode) -> Result<UpdateStatus, UpdateKitError>;
    pub fn plan_update(&self, status: &UpdateStatus, detection: &InstallDetection) -> Option<UpdatePlan>;
    pub async fn apply_update(&self, plan: &UpdatePlan, options: ApplyOptions) -> ApplyResult;

    pub async fn check_and_notify(&self) -> Result<Option<String>, UpdateKitError>;
    pub async fn auto_update(&self, options: ApplyOptions) -> ApplyResult;
    pub async fn list_versions(&self, options: FetchVersionsOptions) -> Result<VersionListResult, UpdateKitError>;
    pub async fn switch_version(&self, target: &str, options: ApplyOptions) -> ApplyResult;
}
```

## Dependencies

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
semver = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
sha2 = "0.10"
flate2 = "1"
tar = "0.4"
zip = "2"
dirs = "6"
async-trait = "0.1"

[dev-dependencies]
mockito = "1"
tempfile = "3"
tokio = { version = "1", features = ["test-util"] }
```

CLI crate additionally:
```toml
clap = { version = "4", features = ["derive"] }
```

## Error Handling

```rust
#[derive(Debug, thiserror::Error)]
pub enum UpdateKitError {
    #[error("Detection failed: {0}")]
    DetectionFailed(String),
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("Insecure URL rejected: {0}")]
    InsecureUrl(String),
    #[error("Download failed: {0}")]
    DownloadFailed(String),
    #[error("Checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },
    #[error("Checksum missing")]
    ChecksumMissing,
    #[error("Checksum fetch failed: {0}")]
    ChecksumFetchFailed(String),
    #[error("Checksum parse failed: {0}")]
    ChecksumParseFailed(String),
    #[error("Extract failed: {0}")]
    ExtractFailed(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Command failed: {0}")]
    CommandFailed(String),
    #[error("Command timeout after {0}ms")]
    CommandTimeout(u64),
    #[error("Command aborted")]
    CommandAborted,
    #[error("Command spawn failed: {0}")]
    CommandSpawnFailed(String),
    #[error("Apply failed: {0}")]
    ApplyFailed(String),
    #[error("Cache error: {0}")]
    CacheError(String),
    #[error("Version parse error: {0}")]
    VersionParse(String),
    #[error("Unsupported platform: {0}")]
    UnsupportedPlatform(String),
    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
```

## Hooks

```rust
pub struct Hooks {
    pub before_check: Option<Box<dyn Fn() -> bool + Send + Sync>>,
    pub before_apply: Option<Box<dyn Fn(&UpdatePlan) -> bool + Send + Sync>>,
    pub after_apply: Option<Box<dyn Fn(&ApplyResult) + Send + Sync>>,
    pub on_error: Option<Box<dyn Fn(&UpdateKitError) + Send + Sync>>,
}
```

## Background Check

Same approach as TypeScript: spawn self as background process via `std::process::Command`.

```rust
pub fn spawn_background_check(config: &ResolvedUpdateKitConfig) -> Result<(), UpdateKitError> {
    let exe = std::env::current_exe()?;
    Command::new(exe)
        .arg("--update-kit-background-check")
        .arg("--config")
        .arg(serde_json::to_string(config)?)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}
```

## Platform-Specific Behavior

| Feature | Unix | Windows |
|---------|------|---------|
| Atomic replace | copy → rename | backup `.old` → copy → cleanup with rollback |
| Permissions | `chmod 0o755` | inherit from parent |
| Cache dir | `$XDG_CACHE_HOME` or `~/.cache` | `%LOCALAPPDATA%` |
| Config dir | `$XDG_CONFIG_HOME` or `~/.config` | `%APPDATA%` |
| Archive extract | tar+flate2 (native Rust) | zip crate / tar+flate2 |
| Process detach | Pre-exec `setsid` | `CREATE_NO_WINDOW` flag |

Use `#[cfg(unix)]` / `#[cfg(windows)]` conditional compilation for platform-specific code.

## Safety Policies (Same as TS)

- HTTPS-only: reject `http://` URLs
- Checksum verification required by default
- Atomic file replacement to prevent corruption
- Never elevate privileges (no sudo)
- `delegate-command` defaults to `print-only` mode
- Low-confidence detections result in print-only behavior

## Testing Strategy

- Unit tests in each module using `#[cfg(test)]`
- Integration tests in `tests/` directory
- Mock HTTP with `mockito` crate
- Mock filesystem with `tempfile`
- Mock process spawning where needed
- Test platform-specific code with `#[cfg(test)]` + conditional compilation
