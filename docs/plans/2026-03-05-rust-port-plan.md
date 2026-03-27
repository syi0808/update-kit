# update-kit Rust Port Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port update-kit to Rust as a crate (`update-kit`) for Rust CLI developers, with full 1:1 feature parity.

**Architecture:** Cargo workspace under `rust/` with two crates: `update-kit` (library) and `update-kit-cli` (binary). Pipeline architecture (detect → check → plan → apply) mirrors the TypeScript version using Rust enums for discriminated unions, `async-trait` for the VersionSource plugin interface, and tokio+reqwest for async I/O.

**Tech Stack:** Rust, tokio, reqwest, semver, serde/serde_json, thiserror, sha2, flate2, tar, zip, dirs, clap, async-trait

---

### Task 1: Scaffold Cargo Workspace

**Files:**
- Create: `rust/Cargo.toml`
- Create: `rust/crates/update-kit/Cargo.toml`
- Create: `rust/crates/update-kit/src/lib.rs`
- Create: `rust/crates/update-kit-cli/Cargo.toml`
- Create: `rust/crates/update-kit-cli/src/main.rs`

**Step 1: Create workspace root Cargo.toml**

```toml
# rust/Cargo.toml
[workspace]
resolver = "2"
members = ["crates/update-kit", "crates/update-kit-cli"]
```

**Step 2: Create library crate Cargo.toml**

```toml
# rust/crates/update-kit/Cargo.toml
[package]
name = "update-kit"
version = "0.1.0"
edition = "2021"
description = "Channel-aware self-update toolkit for CLI applications"
license = "MIT"

[dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
semver = { version = "1", features = ["serde"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
sha2 = "0.10"
flate2 = "1"
tar = "0.4"
zip = "2"
dirs = "6"
async-trait = "0.1"
regex = "1"

[dev-dependencies]
mockito = "1"
tempfile = "3"
tokio = { version = "1", features = ["test-util"] }
```

**Step 3: Create minimal lib.rs**

```rust
// rust/crates/update-kit/src/lib.rs
pub mod config;
pub mod constants;
pub mod errors;
pub mod types;
```

**Step 4: Create CLI crate Cargo.toml**

```toml
# rust/crates/update-kit-cli/Cargo.toml
[package]
name = "update-kit-cli"
version = "0.1.0"
edition = "2021"

[dependencies]
update-kit = { path = "../update-kit" }
clap = { version = "4", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
serde_json = "1"
```

**Step 5: Create minimal main.rs**

```rust
// rust/crates/update-kit-cli/src/main.rs
fn main() {
    println!("update-kit CLI");
}
```

**Step 6: Verify workspace builds**

Run: `cd rust && cargo build`
Expected: Successful compilation

**Step 7: Commit**

```bash
git add rust/
git commit -m "feat(rust): scaffold Cargo workspace with update-kit and update-kit-cli crates"
```

---

### Task 2: Core Types (types.rs)

**Files:**
- Create: `rust/crates/update-kit/src/types.rs`
- Test: inline `#[cfg(test)]` module

**Reference:** `src/types.ts`

**Step 1: Write tests for core type construction and matching**

```rust
// At the bottom of types.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_equality() {
        assert_eq!(Channel::Native, Channel::Native);
        assert_ne!(Channel::Native, Channel::NpmGlobal);
        assert_eq!(
            Channel::Custom("snap".into()),
            Channel::Custom("snap".into())
        );
    }

    #[test]
    fn confidence_ordering() {
        assert!(Confidence::High > Confidence::Medium);
        assert!(Confidence::Medium > Confidence::Low);
        assert!(Confidence::Low > Confidence::None);
    }

    #[test]
    fn update_status_available() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: Some("https://example.com".into()),
            release_notes: None,
            assets: None,
        };
        assert!(matches!(status, UpdateStatus::Available { .. }));
    }

    #[test]
    fn plan_kind_native() {
        let kind = PlanKind::NativeInPlace {
            download_url: "https://example.com/bin".into(),
            checksum_url: None,
            expected_checksum: None,
        };
        assert!(matches!(kind, PlanKind::NativeInPlace { .. }));
    }

    #[test]
    fn apply_result_success() {
        let result = ApplyResult::Success {
            from_version: "1.0.0".into(),
            to_version: "2.0.0".into(),
            post_action: PostAction::SuggestRestart,
        };
        assert!(matches!(result, ApplyResult::Success { .. }));
    }

    #[test]
    fn channel_serialization() {
        let channel = Channel::NpmGlobal;
        let json = serde_json::to_string(&channel).unwrap();
        assert_eq!(json, "\"npm-global\"");
        let back: Channel = serde_json::from_str(&json).unwrap();
        assert_eq!(back, Channel::NpmGlobal);
    }

    #[test]
    fn channel_custom_serialization() {
        let channel = Channel::Custom("snap".into());
        let json = serde_json::to_string(&channel).unwrap();
        assert_eq!(json, "\"snap\"");
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd rust && cargo test -p update-kit`
Expected: Compilation errors (types not defined yet)

**Step 3: Implement types.rs**

```rust
// rust/crates/update-kit/src/types.rs
use serde::{Deserialize, Serialize};

use crate::errors::UpdateKitError;

// ──────────────────────────────────────────────
// Install channel detection
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Channel {
    Native,
    Unmanaged,
    NpmGlobal,
    BrewCask,
    #[serde(untagged)]
    Custom(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    None,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub source: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallDetection {
    pub channel: Channel,
    pub confidence: Confidence,
    pub evidence: Vec<Evidence>,
}

// ──────────────────────────────────────────────
// Version checking
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckMode {
    Blocking,
    NonBlocking,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetInfo {
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum UpdateStatus {
    Available {
        current: String,
        latest: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        release_url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        release_notes: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        assets: Option<Vec<AssetInfo>>,
    },
    UpToDate {
        current: String,
    },
    Unknown {
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        cached_latest: Option<String>,
    },
}

// ──────────────────────────────────────────────
// Update planning
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DelegateMode {
    PrintOnly,
    Execute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PlanKind {
    NativeInPlace {
        download_url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        checksum_url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
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
        #[serde(skip_serializing_if = "Option::is_none")]
        download_url: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PostAction {
    SuggestRestart,
    ExitAfterApply,
    Reexec,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlan {
    pub kind: PlanKind,
    pub from_version: String,
    pub to_version: String,
    pub post_action: PostAction,
}

// ──────────────────────────────────────────────
// Update application
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone)]
pub enum ApplyProgress {
    Downloading {
        bytes_downloaded: u64,
        total_bytes: Option<u64>,
    },
    Verifying,
    Extracting,
    Replacing,
    Executing {
        output: String,
        stream: OutputStream,
    },
    Done,
}

#[derive(Debug)]
pub enum ApplyResult {
    Success {
        from_version: String,
        to_version: String,
        post_action: PostAction,
    },
    UpToDate {
        current: String,
    },
    NeedsRestart {
        message: String,
    },
    Failed {
        error: UpdateKitError,
        rollback_succeeded: bool,
    },
}
```

**Step 4: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add rust/
git commit -m "feat(rust): add core types (Channel, UpdateStatus, PlanKind, ApplyResult)"
```

---

### Task 3: Error Types (errors.rs)

**Files:**
- Create: `rust/crates/update-kit/src/errors.rs`

**Reference:** `src/errors.ts`

**Step 1: Write tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let err = UpdateKitError::InsecureUrl("http://example.com".into());
        assert!(err.to_string().contains("http://example.com"));
    }

    #[test]
    fn error_code() {
        let err = UpdateKitError::ChecksumMismatch {
            expected: "abc".into(),
            actual: "def".into(),
        };
        assert_eq!(err.code(), "CHECKSUM_MISMATCH");
    }

    #[test]
    fn io_error_conversion() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "not found");
        let err: UpdateKitError = io_err.into();
        assert!(matches!(err, UpdateKitError::Io(_)));
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd rust && cargo test -p update-kit`
Expected: Compilation errors

**Step 3: Implement errors.rs**

```rust
// rust/crates/update-kit/src/errors.rs

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

    #[error("Checksum missing: {0}")]
    ChecksumMissing(String),

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

impl UpdateKitError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::DetectionFailed(_) => "DETECTION_FAILED",
            Self::NetworkError(_) => "NETWORK_ERROR",
            Self::InsecureUrl(_) => "INSECURE_URL",
            Self::DownloadFailed(_) => "DOWNLOAD_FAILED",
            Self::ChecksumMismatch { .. } => "CHECKSUM_MISMATCH",
            Self::ChecksumMissing(_) => "CHECKSUM_MISSING",
            Self::ChecksumFetchFailed(_) => "CHECKSUM_FETCH_FAILED",
            Self::ChecksumParseFailed(_) => "CHECKSUM_PARSE_FAILED",
            Self::ExtractFailed(_) => "EXTRACT_FAILED",
            Self::PermissionDenied(_) => "PERMISSION_DENIED",
            Self::CommandFailed(_) => "COMMAND_FAILED",
            Self::CommandTimeout(_) => "COMMAND_TIMEOUT",
            Self::CommandAborted => "COMMAND_ABORTED",
            Self::CommandSpawnFailed(_) => "COMMAND_SPAWN_FAILED",
            Self::ApplyFailed(_) => "APPLY_FAILED",
            Self::CacheError(_) => "CACHE_ERROR",
            Self::VersionParse(_) => "VERSION_PARSE",
            Self::UnsupportedPlatform(_) => "UNSUPPORTED_PLATFORM",
            Self::UnsupportedOperation(_) => "UNSUPPORTED_OPERATION",
            Self::Io(_) => "IO_ERROR",
            Self::Json(_) => "JSON_ERROR",
        }
    }
}
```

**Step 4: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add rust/
git commit -m "feat(rust): add UpdateKitError enum with error codes"
```

---

### Task 4: Constants (constants.rs)

**Files:**
- Create: `rust/crates/update-kit/src/constants.rs`

**Reference:** `src/constants.ts`

**Step 1: Implement constants.rs**

```rust
// rust/crates/update-kit/src/constants.rs

/// Default check interval: 20 hours in milliseconds
pub const DEFAULT_CHECK_INTERVAL_MS: u64 = 72_000_000;

/// Default delegate command timeout: 2 minutes
pub const DEFAULT_DELEGATE_TIMEOUT_MS: u64 = 120_000;

/// Default download timeout: 5 minutes
pub const DEFAULT_DOWNLOAD_TIMEOUT_MS: u64 = 300_000;

/// Default background check timeout: 10 seconds
pub const DEFAULT_BACKGROUND_TIMEOUT_MS: u64 = 10_000;

/// Default HTTP fetch timeout: 30 seconds
pub const DEFAULT_FETCH_TIMEOUT_MS: u64 = 30_000;

/// Default version source request timeout: 15 seconds
pub const DEFAULT_SOURCE_TIMEOUT_MS: u64 = 15_000;

/// Maximum stdout/stderr buffer size: 10 MB
pub const MAX_COMMAND_OUTPUT_BYTES: usize = 10 * 1024 * 1024;
```

**Step 2: Verify build**

Run: `cd rust && cargo build -p update-kit`
Expected: Successful compilation

**Step 3: Commit**

```bash
git add rust/
git commit -m "feat(rust): add timeout and buffer size constants"
```

---

### Task 5: Config Types (config.rs)

**Files:**
- Create: `rust/crates/update-kit/src/config.rs`

**Reference:** `src/config.ts`

**Step 1: Write tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_from_explicit() {
        let config = UpdateKitConfig::Explicit {
            app_name: "my-cli".into(),
            current_version: "1.0.0".into(),
            base: BaseConfig::default(),
        };
        let resolved = ResolvedConfig::try_from(config).unwrap();
        assert_eq!(resolved.app_name, "my-cli");
        assert_eq!(resolved.current_version, "1.0.0");
    }

    #[test]
    fn config_from_pkg() {
        let config = UpdateKitConfig::Pkg {
            app_name: None,
            current_version: None,
            pkg: PackageInfo {
                name: "my-cli".into(),
                version: "2.0.0".into(),
            },
            base: BaseConfig::default(),
        };
        let resolved = ResolvedConfig::try_from(config).unwrap();
        assert_eq!(resolved.app_name, "my-cli");
        assert_eq!(resolved.current_version, "2.0.0");
    }

    #[test]
    fn config_missing_name_fails() {
        let config = UpdateKitConfig::Pkg {
            app_name: None,
            current_version: Some("1.0.0".into()),
            pkg: PackageInfo {
                name: "".into(),
                version: "1.0.0".into(),
            },
            base: BaseConfig::default(),
        };
        assert!(ResolvedConfig::try_from(config).is_err());
    }

    #[test]
    fn version_source_config_github_serialization() {
        let config = VersionSourceConfig::GitHub {
            owner: "user".into(),
            repo: "repo".into(),
            token: None,
            api_base_url: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"type\":\"github\""));
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd rust && cargo test -p update-kit`

**Step 3: Implement config.rs**

```rust
// rust/crates/update-kit/src/config.rs
use serde::{Deserialize, Serialize};

use crate::types::{DelegateMode, PlanKind, Channel, Confidence, AssetInfo, UpdatePlan, ApplyResult};
use crate::errors::UpdateKitError;
use crate::constants::DEFAULT_CHECK_INTERVAL_MS;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
}

// ──────────────────────────────────────────────
// Version source configurations
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum VersionSourceConfig {
    #[serde(rename = "github")]
    GitHub {
        owner: String,
        repo: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        token: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        api_base_url: Option<String>,
    },
    #[serde(rename = "npm")]
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

// ──────────────────────────────────────────────
// Base config
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BaseConfig {
    // Detection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npm_package_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brew_cask_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,

    // Check
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<VersionSourceConfig>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_interval: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,

    // Plan
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegate_mode: Option<DelegateMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_pattern: Option<String>,

    // Apply
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_reexec: Option<bool>,
}

// ──────────────────────────────────────────────
// UpdateKitConfig (discriminated)
// ──────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum UpdateKitConfig {
    Explicit {
        app_name: String,
        current_version: String,
        base: BaseConfig,
    },
    Pkg {
        app_name: Option<String>,
        current_version: Option<String>,
        pkg: PackageInfo,
        base: BaseConfig,
    },
}

// ──────────────────────────────────────────────
// Plan resolver context (for custom resolvers)
// ──────────────────────────────────────────────

pub struct PlanResolverContext<'a> {
    pub channel: &'a Channel,
    pub confidence: &'a Confidence,
    pub to_version: &'a str,
    pub config: &'a ResolvedConfig,
    pub assets: Option<&'a [AssetInfo]>,
    pub default_plan: &'a PlanKind,
}

/// Type alias for custom plan resolver function
pub type CustomPlanResolver =
    Box<dyn Fn(&PlanResolverContext) -> Option<PlanKind> + Send + Sync>;

/// Type alias for custom detector function
pub type CustomDetectorFn =
    Box<dyn Fn(&str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<crate::types::InstallDetection>> + Send>> + Send + Sync>;

pub struct CustomDetector {
    pub name: String,
    pub detect: CustomDetectorFn,
}

impl std::fmt::Debug for CustomDetector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CustomDetector")
            .field("name", &self.name)
            .finish()
    }
}

// ──────────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────────

pub type HookFn<T> = Box<dyn Fn(T) -> bool + Send + Sync>;

pub struct Hooks {
    pub before_check: Option<Box<dyn Fn() -> bool + Send + Sync>>,
    pub before_apply: Option<Box<dyn Fn(&UpdatePlan) -> bool + Send + Sync>>,
    pub after_apply: Option<Box<dyn Fn(&ApplyResult) + Send + Sync>>,
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

impl std::fmt::Debug for Hooks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hooks")
            .field("before_check", &self.before_check.is_some())
            .field("before_apply", &self.before_apply.is_some())
            .field("after_apply", &self.after_apply.is_some())
            .field("on_error", &self.on_error.is_some())
            .finish()
    }
}

// ──────────────────────────────────────────────
// Resolved config (internal)
// ──────────────────────────────────────────────

#[derive(Debug)]
pub struct ResolvedConfig {
    pub app_name: String,
    pub current_version: String,
    pub pkg: Option<PackageInfo>,
    pub base: BaseConfig,
    pub hooks: Hooks,
    pub custom_plan_resolver: Option<CustomPlanResolver>,
    pub custom_detectors: Vec<CustomDetector>,
}

impl ResolvedConfig {
    pub fn delegate_mode(&self) -> DelegateMode {
        self.base.delegate_mode.unwrap_or(DelegateMode::PrintOnly)
    }

    pub fn allow_reexec(&self) -> bool {
        self.base.allow_reexec.unwrap_or(false)
    }

    pub fn check_interval(&self) -> u64 {
        self.base.check_interval.unwrap_or(DEFAULT_CHECK_INTERVAL_MS)
    }
}

impl TryFrom<UpdateKitConfig> for ResolvedConfig {
    type Error = String;

    fn try_from(config: UpdateKitConfig) -> Result<Self, String> {
        let (app_name, current_version, pkg, base) = match config {
            UpdateKitConfig::Explicit {
                app_name,
                current_version,
                base,
            } => (app_name, current_version, None, base),
            UpdateKitConfig::Pkg {
                app_name,
                current_version,
                pkg,
                base,
            } => {
                let name = app_name.unwrap_or_else(|| pkg.name.clone());
                let version = current_version.unwrap_or_else(|| pkg.version.clone());
                (name, version, Some(pkg), base)
            }
        };

        if app_name.is_empty() {
            return Err("appName is required".into());
        }
        if current_version.is_empty() {
            return Err("currentVersion is required".into());
        }
        if semver::Version::parse(&current_version).is_err() {
            return Err(format!("Invalid semver version: {current_version}"));
        }

        Ok(Self {
            app_name,
            current_version,
            pkg,
            base,
            hooks: Hooks::default(),
            custom_plan_resolver: None,
            custom_detectors: Vec::new(),
        })
    }
}
```

**Step 4: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add rust/
git commit -m "feat(rust): add config types, version source configs, hooks, and resolved config"
```

---

### Task 6: Platform Utilities (platform/)

**Files:**
- Create: `rust/crates/update-kit/src/platform/mod.rs`
- Create: `rust/crates/update-kit/src/platform/paths.rs`
- Create: `rust/crates/update-kit/src/platform/replace.rs`

**Reference:** `src/platform/paths.ts`, `src/platform/replace.ts`

**Step 1: Write tests**

```rust
// paths.rs tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_cache_dir_is_not_empty() {
        let dir = get_default_cache_dir();
        assert!(!dir.as_os_str().is_empty());
    }

    #[test]
    fn default_config_dir_is_not_empty() {
        let dir = get_default_config_dir();
        assert!(!dir.as_os_str().is_empty());
    }
}
```

```rust
// replace.rs tests
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[tokio::test]
    async fn atomic_replace_success() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("target-bin");
        let new_file = tmp.path().join("new-bin");

        fs::write(&target, b"old content").unwrap();
        fs::write(&new_file, b"new content").unwrap();

        atomic_replace(&new_file, &target).await.unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new content");
    }

    #[tokio::test]
    async fn atomic_replace_no_write_permission() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("no-write");
        let new_file = tmp.path().join("new");

        fs::write(&target, b"old").unwrap();
        fs::write(&new_file, b"new").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o444)).unwrap();
        }

        let result = atomic_replace(&new_file, &target).await;
        #[cfg(unix)]
        assert!(result.is_err());
    }
}
```

**Step 2: Implement platform modules**

```rust
// rust/crates/update-kit/src/platform/mod.rs
pub mod paths;
pub mod replace;
```

```rust
// rust/crates/update-kit/src/platform/paths.rs
use std::path::PathBuf;

pub fn get_default_cache_dir() -> PathBuf {
    if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_default()
                    .join("AppData")
                    .join("Local")
            })
    } else {
        std::env::var("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir().unwrap_or_default().join(".cache")
            })
    }
}

pub fn get_default_config_dir() -> PathBuf {
    if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_default()
                    .join("AppData")
                    .join("Local")
            })
    } else {
        std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir().unwrap_or_default().join(".config")
            })
    }
}
```

```rust
// rust/crates/update-kit/src/platform/replace.rs
use std::path::Path;
use tokio::fs;

use crate::errors::UpdateKitError;

pub async fn atomic_replace(
    new_path: &Path,
    target_path: &Path,
) -> Result<(), UpdateKitError> {
    // Check write permission
    let metadata = fs::metadata(target_path).await.map_err(|_| {
        UpdateKitError::PermissionDenied(format!(
            "No write permission: {}",
            target_path.display()
        ))
    })?;

    if metadata.permissions().readonly() {
        return Err(UpdateKitError::PermissionDenied(format!(
            "No write permission: {}. Run with appropriate permissions.",
            target_path.display()
        )));
    }

    #[cfg(unix)]
    unix_replace(new_path, target_path).await?;

    #[cfg(windows)]
    windows_replace(new_path, target_path).await?;

    Ok(())
}

#[cfg(unix)]
async fn unix_replace(new_path: &Path, target_path: &Path) -> Result<(), UpdateKitError> {
    use std::os::unix::fs::PermissionsExt;

    let tmp_in_place = target_path.with_extension(format!("new.{}", std::process::id()));

    let cleanup = || async {
        let _ = fs::remove_file(&tmp_in_place).await;
    };

    if let Err(e) = fs::copy(new_path, &tmp_in_place).await {
        cleanup().await;
        return Err(UpdateKitError::ApplyFailed(e.to_string()));
    }

    if let Err(e) = fs::set_permissions(&tmp_in_place, std::fs::Permissions::from_mode(0o755)).await {
        cleanup().await;
        return Err(UpdateKitError::ApplyFailed(e.to_string()));
    }

    if let Err(e) = fs::rename(&tmp_in_place, target_path).await {
        cleanup().await;
        return Err(UpdateKitError::ApplyFailed(e.to_string()));
    }

    Ok(())
}

#[cfg(windows)]
async fn windows_replace(new_path: &Path, target_path: &Path) -> Result<(), UpdateKitError> {
    let backup_path = target_path.with_extension("old");

    // Clean up previous backup
    let _ = fs::remove_file(&backup_path).await;

    // Move current to .old
    fs::rename(target_path, &backup_path)
        .await
        .map_err(|e| UpdateKitError::ApplyFailed(e.to_string()))?;

    // Copy new to target
    if let Err(copy_err) = fs::copy(new_path, target_path).await {
        // Rollback
        if let Err(rollback_err) = fs::rename(&backup_path, target_path).await {
            return Err(UpdateKitError::ApplyFailed(format!(
                "Update failed and rollback also failed. Original binary may be at {}. \
                 Copy error: {}. Rollback error: {}.",
                backup_path.display(),
                copy_err,
                rollback_err
            )));
        }
        return Err(UpdateKitError::ApplyFailed(copy_err.to_string()));
    }

    // Clean up .old
    let _ = fs::remove_file(&backup_path).await;

    Ok(())
}
```

**Step 3: Update lib.rs to include platform**

Add `pub mod platform;` to lib.rs.

**Step 4: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add rust/
git commit -m "feat(rust): add platform paths and atomic file replacement"
```

---

### Task 7: Utils (utils/)

**Files:**
- Create: `rust/crates/update-kit/src/utils/mod.rs`
- Create: `rust/crates/update-kit/src/utils/http.rs`
- Create: `rust/crates/update-kit/src/utils/security.rs`
- Create: `rust/crates/update-kit/src/utils/fs.rs`

**Reference:** `src/utils/http.ts`, `src/utils/security.ts`

**Step 1: Write tests**

```rust
// security.rs tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_https_accepts_https() {
        assert!(require_https("https://example.com").is_ok());
    }

    #[test]
    fn require_https_rejects_http() {
        assert!(require_https("http://example.com").is_err());
    }

    #[test]
    fn timing_safe_equal_works() {
        assert!(timing_safe_equal("abc123", "ABC123"));
        assert!(!timing_safe_equal("abc123", "abc124"));
    }
}
```

```rust
// http.rs tests
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fetch_rejects_http() {
        let result = fetch_with_timeout("http://example.com", None).await;
        assert!(result.is_err());
    }
}
```

**Step 2: Implement utils modules**

```rust
// rust/crates/update-kit/src/utils/mod.rs
pub mod fs;
pub mod http;
pub mod security;
```

```rust
// rust/crates/update-kit/src/utils/security.rs
use crate::errors::UpdateKitError;

pub fn require_https(url: &str) -> Result<(), UpdateKitError> {
    if !url.starts_with("https://") {
        return Err(UpdateKitError::InsecureUrl(format!(
            "Only HTTPS URLs are allowed. Got: {url}"
        )));
    }
    Ok(())
}

pub fn timing_safe_equal(a: &str, b: &str) -> bool {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    if a_lower.len() != b_lower.len() {
        return false;
    }

    let a_bytes = a_lower.as_bytes();
    let b_bytes = b_lower.as_bytes();

    let mut result: u8 = 0;
    for (x, y) in a_bytes.iter().zip(b_bytes.iter()) {
        result |= x ^ y;
    }
    result == 0
}
```

```rust
// rust/crates/update-kit/src/utils/http.rs
use std::time::Duration;

use reqwest::{Client, Response};

use crate::constants::DEFAULT_FETCH_TIMEOUT_MS;
use crate::errors::UpdateKitError;
use crate::utils::security::require_https;

pub struct FetchOptions {
    pub timeout_ms: Option<u64>,
    pub headers: Option<Vec<(String, String)>>,
}

pub async fn fetch_with_timeout(
    url: &str,
    options: Option<FetchOptions>,
) -> Result<Response, UpdateKitError> {
    require_https(url)?;

    let timeout_ms = options
        .as_ref()
        .and_then(|o| o.timeout_ms)
        .unwrap_or(DEFAULT_FETCH_TIMEOUT_MS);

    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()?;

    let mut req = client.get(url);

    if let Some(opts) = &options {
        if let Some(headers) = &opts.headers {
            for (key, value) in headers {
                req = req.header(key.as_str(), value.as_str());
            }
        }
    }

    let response = req.send().await?;
    Ok(response)
}
```

```rust
// rust/crates/update-kit/src/utils/fs.rs
use std::path::Path;
use tokio::fs;

/// Create directory and all parent directories if they don't exist.
pub async fn ensure_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path).await
}
```

**Step 3: Update lib.rs**

Add `pub mod utils;` to lib.rs.

**Step 4: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add rust/
git commit -m "feat(rust): add HTTP, security, and filesystem utilities"
```

---

### Task 8: Detection Module (detection/)

**Files:**
- Create: `rust/crates/update-kit/src/detection/mod.rs`
- Create: `rust/crates/update-kit/src/detection/receipt.rs`
- Create: `rust/crates/update-kit/src/detection/brew.rs`
- Create: `rust/crates/update-kit/src/detection/npm.rs`
- Create: `rust/crates/update-kit/src/detection/heuristics.rs`

**Reference:** `src/detection/index.ts`, `src/detection/receipt.ts`, `src/detection/brew.ts`, `src/detection/npm.ts`, `src/detection/heuristics.ts`

**Step 1: Write tests for detection orchestrator**

```rust
// detection/mod.rs tests
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fallback_to_unmanaged() {
        let config = DetectionConfig {
            app_name: "test-app",
            brew_cask_name: None,
            custom_detectors: &[],
        };
        let result = detect_install("/some/random/path", &config).await;
        assert_eq!(result.channel, Channel::Unmanaged);
    }
}
```

```rust
// detection/receipt.rs tests
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs;

    #[tokio::test]
    async fn detect_valid_receipt() {
        let tmp = TempDir::new().unwrap();
        let receipt_dir = tmp.path().join("test-app");
        fs::create_dir_all(&receipt_dir).await.unwrap();
        fs::write(
            receipt_dir.join("install-receipt.json"),
            r#"{"channel": "native"}"#,
        )
        .await
        .unwrap();

        let result = detect_from_receipt("test-app", Some(tmp.path())).await;
        assert!(result.is_some());
        let det = result.unwrap();
        assert_eq!(det.channel, Channel::Native);
        assert_eq!(det.confidence, Confidence::High);
    }

    #[tokio::test]
    async fn no_receipt_returns_none() {
        let result = detect_from_receipt("nonexistent-app", None).await;
        assert!(result.is_none());
    }
}
```

```rust
// detection/heuristics.rs tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn homebrew_path_detected() {
        let evidence = collect_path_heuristics("/opt/homebrew/bin/my-cli");
        assert!(evidence.iter().any(|e| e.source == "path_pattern"));
    }

    #[test]
    fn npm_path_detected() {
        let evidence = collect_path_heuristics("/usr/local/lib/node_modules/.bin/my-cli");
        assert!(evidence.iter().any(|e| e.source == "path_pattern"));
    }

    #[test]
    fn random_path_no_evidence() {
        let evidence = collect_path_heuristics("/tmp/random-binary");
        assert!(evidence.is_empty());
    }
}
```

**Step 2: Implement detection modules**

```rust
// rust/crates/update-kit/src/detection/mod.rs
pub mod brew;
pub mod heuristics;
pub mod npm;
pub mod receipt;

use crate::config::CustomDetector;
use crate::types::{Channel, Confidence, Evidence, InstallDetection};

pub struct DetectionConfig<'a> {
    pub app_name: &'a str,
    pub brew_cask_name: Option<&'a str>,
    pub custom_detectors: &'a [CustomDetector],
}

pub async fn detect_install(
    exec_path: &str,
    config: &DetectionConfig<'_>,
) -> InstallDetection {
    // Resolve symlinks
    let resolved_path = tokio::fs::canonicalize(exec_path)
        .await
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| exec_path.to_string());

    // 0. Custom detectors
    for detector in config.custom_detectors {
        if let Some(result) = (detector.detect)(&resolved_path).await {
            return result;
        }
    }

    // 1. Install receipt
    if let Some(result) = receipt::detect_from_receipt(config.app_name, None).await {
        return result;
    }

    // 2. Homebrew
    if let Some(result) = brew::detect_from_brew(&resolved_path, config.brew_cask_name).await {
        return result;
    }

    // 3. npm global
    if let Some(result) = npm::detect_from_npm(&resolved_path).await {
        return result;
    }

    // 4. Fallback
    let heuristic_evidence = heuristics::collect_path_heuristics(&resolved_path);
    let confidence = if heuristic_evidence.is_empty() {
        Confidence::None
    } else {
        Confidence::Low
    };

    InstallDetection {
        channel: Channel::Unmanaged,
        confidence,
        evidence: {
            let mut ev = vec![Evidence {
                source: "fallback".into(),
                detail: "No known install channel pattern matched".into(),
            }];
            ev.extend(heuristic_evidence);
            ev
        },
    }
}
```

```rust
// rust/crates/update-kit/src/detection/receipt.rs
use std::path::Path;
use crate::platform::paths::get_default_config_dir;
use crate::types::{Channel, Confidence, Evidence, InstallDetection};

pub async fn detect_from_receipt(
    app_name: &str,
    receipt_dir: Option<&Path>,
) -> Option<InstallDetection> {
    let base_dir = receipt_dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(get_default_config_dir);

    let receipt_path = base_dir.join(app_name).join("install-receipt.json");

    let content = tokio::fs::read_to_string(&receipt_path).await.ok()?;
    let _parsed: serde_json::Value = serde_json::from_str(&content).ok()?;

    Some(InstallDetection {
        channel: Channel::Native,
        confidence: Confidence::High,
        evidence: vec![Evidence {
            source: "receipt_file".into(),
            detail: format!("Found install receipt at {}", receipt_path.display()),
        }],
    })
}
```

```rust
// rust/crates/update-kit/src/detection/brew.rs
use crate::types::{Channel, Confidence, Evidence, InstallDetection};

const BREW_PATH_PATTERNS: &[&str] = &[
    "/opt/homebrew/",
    "/usr/local/Caskroom/",
    "/usr/local/Cellar/",
    "/home/linuxbrew/",
];

pub async fn detect_from_brew(
    exec_path: &str,
    brew_cask_name: Option<&str>,
) -> Option<InstallDetection> {
    let is_brew_path = BREW_PATH_PATTERNS
        .iter()
        .any(|pattern| exec_path.contains(pattern));

    if !is_brew_path {
        return None;
    }

    let mut evidence = vec![Evidence {
        source: "path_pattern".into(),
        detail: format!("Path matches Homebrew pattern: {exec_path}"),
    }];

    // Try to verify with `brew list --cask`
    let confidence = if let Some(cask_name) = brew_cask_name {
        match verify_brew_cask(cask_name).await {
            true => {
                evidence.push(Evidence {
                    source: "brew_list".into(),
                    detail: format!("Verified via `brew list --cask {cask_name}`"),
                });
                Confidence::High
            }
            false => Confidence::Medium,
        }
    } else {
        Confidence::Medium
    };

    Some(InstallDetection {
        channel: Channel::BrewCask,
        confidence,
        evidence,
    })
}

async fn verify_brew_cask(cask_name: &str) -> bool {
    let output = tokio::process::Command::new("brew")
        .args(["list", "--cask", cask_name])
        .output()
        .await;

    matches!(output, Ok(o) if o.status.success())
}
```

```rust
// rust/crates/update-kit/src/detection/npm.rs
use crate::types::{Channel, Confidence, Evidence, InstallDetection};

const NPM_PATH_PATTERNS: &[&str] = &[
    "node_modules",
    "/lib/node_modules/",
    "/.npm/",
];

pub async fn detect_from_npm(exec_path: &str) -> Option<InstallDetection> {
    let is_npm_path = NPM_PATH_PATTERNS
        .iter()
        .any(|pattern| exec_path.contains(pattern));

    if !is_npm_path {
        return None;
    }

    let mut evidence = vec![Evidence {
        source: "path_pattern".into(),
        detail: format!("Path matches npm global pattern: {exec_path}"),
    }];

    // Try `npm prefix -g` to verify
    let confidence = match verify_npm_global(exec_path).await {
        true => {
            evidence.push(Evidence {
                source: "npm_prefix".into(),
                detail: "Verified via `npm prefix -g`".into(),
            });
            Confidence::High
        }
        false => Confidence::Medium,
    };

    Some(InstallDetection {
        channel: Channel::NpmGlobal,
        confidence,
        evidence,
    })
}

async fn verify_npm_global(exec_path: &str) -> bool {
    let output = tokio::process::Command::new("npm")
        .args(["prefix", "-g"])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let prefix = String::from_utf8_lossy(&o.stdout).trim().to_string();
            exec_path.starts_with(&prefix)
        }
        _ => false,
    }
}
```

```rust
// rust/crates/update-kit/src/detection/heuristics.rs
use crate::types::Evidence;

const BREW_INDICATORS: &[&str] = &[
    "/opt/homebrew/",
    "/usr/local/Caskroom/",
    "/usr/local/Cellar/",
    "/home/linuxbrew/",
];

const NPM_INDICATORS: &[&str] = &[
    "node_modules",
    "/lib/node_modules/",
    "/.npm/",
];

pub fn collect_path_heuristics(exec_path: &str) -> Vec<Evidence> {
    let mut evidence = Vec::new();

    for pattern in BREW_INDICATORS {
        if exec_path.contains(pattern) {
            evidence.push(Evidence {
                source: "path_pattern".into(),
                detail: format!("Path contains Homebrew indicator: {pattern}"),
            });
            break;
        }
    }

    for pattern in NPM_INDICATORS {
        if exec_path.contains(pattern) {
            evidence.push(Evidence {
                source: "path_pattern".into(),
                detail: format!("Path contains npm indicator: {pattern}"),
            });
            break;
        }
    }

    evidence
}
```

**Step 3: Update lib.rs**

Add `pub mod detection;` to lib.rs.

**Step 4: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add rust/
git commit -m "feat(rust): add detection module (receipt, brew, npm, heuristics)"
```

---

### Task 9: Checker - Cache (checker/cache.rs)

**Files:**
- Create: `rust/crates/update-kit/src/checker/mod.rs`
- Create: `rust/crates/update-kit/src/checker/cache.rs`

**Reference:** `src/checker/cache.ts`

**Step 1: Write tests**

```rust
// checker/cache.rs tests
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn write_and_read_cache() {
        let tmp = TempDir::new().unwrap();
        let entry = CacheEntry {
            latest_version: "2.0.0".into(),
            current_version_at_check: "1.0.0".into(),
            last_checked_at: chrono_now_iso(),
            source: "github".into(),
            etag: Some("abc".into()),
            release_url: None,
            release_notes: None,
        };
        write_cache(tmp.path(), "my-app", &entry).await.unwrap();
        let read = read_cache(tmp.path(), "my-app").await.unwrap();
        assert_eq!(read.latest_version, "2.0.0");
        assert_eq!(read.etag, Some("abc".into()));
    }

    #[tokio::test]
    async fn read_missing_cache_returns_none() {
        let tmp = TempDir::new().unwrap();
        let result = read_cache(tmp.path(), "nonexistent").await;
        assert!(result.is_none());
    }

    #[test]
    fn stale_cache_detected() {
        let entry = CacheEntry {
            latest_version: "1.0.0".into(),
            current_version_at_check: "1.0.0".into(),
            last_checked_at: "2020-01-01T00:00:00Z".into(),
            source: "npm".into(),
            etag: None,
            release_url: None,
            release_notes: None,
        };
        assert!(is_cache_stale(&entry, 1000));
    }

    #[test]
    fn fresh_cache_not_stale() {
        let entry = CacheEntry {
            latest_version: "1.0.0".into(),
            current_version_at_check: "1.0.0".into(),
            last_checked_at: chrono_now_iso(),
            source: "npm".into(),
            etag: None,
            release_url: None,
            release_notes: None,
        };
        assert!(!is_cache_stale(&entry, 72_000_000));
    }

    #[tokio::test]
    async fn clear_cache_removes_file() {
        let tmp = TempDir::new().unwrap();
        let entry = CacheEntry {
            latest_version: "1.0.0".into(),
            current_version_at_check: "1.0.0".into(),
            last_checked_at: chrono_now_iso(),
            source: "npm".into(),
            etag: None,
            release_url: None,
            release_notes: None,
        };
        write_cache(tmp.path(), "my-app", &entry).await.unwrap();
        clear_cache(tmp.path(), "my-app").await.unwrap();
        assert!(read_cache(tmp.path(), "my-app").await.is_none());
    }
}
```

**Step 2: Implement cache.rs**

```rust
// rust/crates/update-kit/src/checker/cache.rs
use std::path::Path;
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::errors::UpdateKitError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub latest_version: String,
    pub current_version_at_check: String,
    pub last_checked_at: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
}

fn cache_path(cache_dir: &Path, app_name: &str) -> std::path::PathBuf {
    cache_dir.join(app_name).join("update-check.json")
}

pub fn chrono_now_iso() -> String {
    // Use std::time for ISO 8601 timestamp
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // Simple ISO 8601 format using seconds since epoch
    // For production, consider using the `chrono` or `time` crate
    format!("{}000", now.as_millis())
        // Actually, let's use a proper format
        ;
    // Simplified: store as milliseconds timestamp string for now,
    // parse back consistently
    now.as_millis().to_string()
}

pub async fn read_cache(cache_dir: &Path, app_name: &str) -> Option<CacheEntry> {
    let file_path = cache_path(cache_dir, app_name);
    let raw = fs::read_to_string(&file_path).await.ok()?;
    let entry: CacheEntry = serde_json::from_str(&raw).ok()?;

    // Validate required fields
    if entry.latest_version.is_empty()
        || entry.current_version_at_check.is_empty()
        || entry.last_checked_at.is_empty()
        || entry.source.is_empty()
    {
        return None;
    }

    // Validate timestamp is parseable
    if entry.last_checked_at.parse::<u128>().is_err() {
        return None;
    }

    Some(entry)
}

pub async fn write_cache(
    cache_dir: &Path,
    app_name: &str,
    entry: &CacheEntry,
) -> Result<(), UpdateKitError> {
    let file_path = cache_path(cache_dir, app_name);
    let dir = file_path.parent().unwrap();
    fs::create_dir_all(dir).await.map_err(|e| {
        UpdateKitError::CacheError(format!("Failed to create cache dir: {e}"))
    })?;

    let tmp_path = file_path.with_extension(format!("{}-{}.tmp", std::process::id(), timestamp_ms()));

    let data = serde_json::to_string_pretty(entry)
        .map_err(|e| UpdateKitError::CacheError(e.to_string()))?;

    if let Err(e) = fs::write(&tmp_path, format!("{data}\n")).await {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(UpdateKitError::CacheError(format!(
            "Failed to write cache for {app_name}: {e}"
        )));
    }

    if let Err(e) = fs::rename(&tmp_path, &file_path).await {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(UpdateKitError::CacheError(format!(
            "Failed to write cache for {app_name}: {e}"
        )));
    }

    Ok(())
}

pub fn is_cache_stale(entry: &CacheEntry, interval_ms: u64) -> bool {
    let checked_at: u128 = match entry.last_checked_at.parse() {
        Ok(v) => v,
        Err(_) => return true,
    };

    let now = timestamp_ms() as u128;
    now > checked_at + interval_ms as u128
}

pub async fn clear_cache(cache_dir: &Path, app_name: &str) -> Result<(), UpdateKitError> {
    let file_path = cache_path(cache_dir, app_name);
    match fs::remove_file(&file_path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(UpdateKitError::CacheError(e.to_string())),
    }
}

pub fn create_cache_entry(
    version: &str,
    current_version: &str,
    source_name: &str,
    etag: Option<String>,
    release_url: Option<String>,
    release_notes: Option<String>,
) -> CacheEntry {
    CacheEntry {
        latest_version: version.to_string(),
        current_version_at_check: current_version.to_string(),
        last_checked_at: timestamp_ms().to_string(),
        source: source_name.to_string(),
        etag,
        release_url,
        release_notes,
    }
}

fn timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
```

```rust
// rust/crates/update-kit/src/checker/mod.rs
pub mod cache;
```

**Step 3: Update lib.rs**

Add `pub mod checker;` to lib.rs.

**Step 4: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add rust/
git commit -m "feat(rust): add checker cache module (read, write, stale, clear)"
```

---

### Task 10: Checker - VersionSource Trait and Sources (checker/sources/)

**Files:**
- Create: `rust/crates/update-kit/src/checker/sources/mod.rs`
- Create: `rust/crates/update-kit/src/checker/sources/github.rs`
- Create: `rust/crates/update-kit/src/checker/sources/npm_registry.rs`
- Create: `rust/crates/update-kit/src/checker/sources/jsr.rs`
- Create: `rust/crates/update-kit/src/checker/sources/brew_api.rs`
- Create: `rust/crates/update-kit/src/checker/sources/custom_manifest.rs`

**Reference:** `src/checker/sources/index.ts`, `src/checker/sources/github.ts`, etc.

**Step 1: Write tests for VersionSource trait and factory**

```rust
// checker/sources/mod.rs tests
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::VersionSourceConfig;

    #[test]
    fn create_github_source() {
        let config = VersionSourceConfig::GitHub {
            owner: "user".into(),
            repo: "repo".into(),
            token: None,
            api_base_url: None,
        };
        let source = create_version_source(config);
        assert_eq!(source.name(), "github");
    }

    #[test]
    fn create_npm_source() {
        let config = VersionSourceConfig::Npm {
            package_name: "my-pkg".into(),
            registry_url: None,
        };
        let source = create_version_source(config);
        assert_eq!(source.name(), "npm");
    }
}
```

**Step 2: Implement VersionSource trait and all 5 sources**

Each source implementation follows the same pattern: implement the `VersionSource` trait with `fetch_latest` (and optionally `fetch_versions`). Each source uses reqwest for HTTP or `tokio::process::Command` for shell commands (brew).

The implementations should mirror the TypeScript versions:
- **GitHub**: GET `https://api.github.com/repos/{owner}/{repo}/releases/latest`, parse version from tag_name, extract assets
- **npm**: GET `https://registry.npmjs.org/{package}/latest`, parse version field
- **JSR**: GET `https://jsr.io/@{scope}/{name}/meta.json`, parse latest version
- **Brew**: Run `brew info --json=v2 --cask {cask_name}`, parse version
- **Custom**: GET user URL, extract version from configurable JSON field path

Each source should handle ETag for conditional requests where applicable.

**Step 3: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 4: Commit**

```bash
git add rust/
git commit -m "feat(rust): add VersionSource trait and 5 source implementations"
```

---

### Task 11: Checker - Source Inference and Check Orchestrator

**Files:**
- Create: `rust/crates/update-kit/src/checker/infer_sources.rs`
- Create: `rust/crates/update-kit/src/checker/background.rs`
- Modify: `rust/crates/update-kit/src/checker/mod.rs` (add `check_update`, `normalize_version`)

**Reference:** `src/checker/infer-sources.ts`, `src/checker/index.ts`, `src/checker/background.ts`

**Step 1: Write tests**

```rust
// infer_sources.rs tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_github_url() {
        let result = parse_github_repository("https://github.com/user/repo");
        assert_eq!(result, Some(("user".into(), "repo".into())));
    }

    #[test]
    fn parse_github_shorthand() {
        let result = parse_github_repository("github:user/repo");
        assert_eq!(result, Some(("user".into(), "repo".into())));
    }

    #[test]
    fn order_sources_npm_channel() {
        // npm-global channel should put npm first
        let sources = vec![
            VersionSourceConfig::GitHub { owner: "u".into(), repo: "r".into(), token: None, api_base_url: None },
            VersionSourceConfig::Npm { package_name: "pkg".into(), registry_url: None },
        ];
        let ordered = order_sources_by_channel(sources, &Channel::NpmGlobal);
        assert!(matches!(ordered[0], VersionSourceConfig::Npm { .. }));
    }
}
```

**Step 2: Implement infer_sources.rs, background.rs, and check_update in mod.rs**

The `check_update` function handles both blocking and non-blocking modes:
- **Blocking**: iterate sources, fetch from first successful
- **Non-blocking**: read cache, if stale spawn background check, return cached/unknown

`normalize_version` uses the `semver` crate to parse and normalize version strings (strip leading `v`, etc.).

`spawn_background_check` uses `std::process::Command` to spawn the current executable with a special flag and serialized config.

**Step 3: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 4: Commit**

```bash
git add rust/
git commit -m "feat(rust): add source inference, background check, and check_update orchestrator"
```

---

### Task 12: Planner Module (planner/)

**Files:**
- Create: `rust/crates/update-kit/src/planner/mod.rs`

**Reference:** `src/planner/index.ts` (already read fully)

**Step 1: Write tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{BaseConfig, ResolvedConfig, PackageInfo};

    fn test_config() -> ResolvedConfig {
        ResolvedConfig {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            pkg: None,
            base: BaseConfig::default(),
            hooks: Default::default(),
            custom_plan_resolver: None,
            custom_detectors: Vec::new(),
        }
    }

    #[test]
    fn up_to_date_returns_none() {
        let status = UpdateStatus::UpToDate { current: "1.0.0".into() };
        let detection = InstallDetection {
            channel: Channel::Native,
            confidence: Confidence::High,
            evidence: vec![],
        };
        assert!(plan_update(&status, &detection, &test_config(), None).is_none());
    }

    #[test]
    fn native_high_confidence_gives_native_in_place() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: Some(vec![AssetInfo {
                name: "test-app-darwin-arm64.tar.gz".into(),
                url: "https://example.com/bin.tar.gz".into(),
                size: None,
                checksum_url: None,
            }]),
        };
        let detection = InstallDetection {
            channel: Channel::Native,
            confidence: Confidence::High,
            evidence: vec![],
        };
        let plan = plan_update(&status, &detection, &test_config(), None).unwrap();
        assert!(matches!(plan.kind, PlanKind::NativeInPlace { .. }));
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
        let detection = InstallDetection {
            channel: Channel::NpmGlobal,
            confidence: Confidence::High,
            evidence: vec![],
        };
        let plan = plan_update(&status, &detection, &test_config(), None).unwrap();
        assert!(matches!(plan.kind, PlanKind::DelegateCommand { .. }));
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
        let detection = InstallDetection {
            channel: Channel::NpmGlobal,
            confidence: Confidence::Low,
            evidence: vec![],
        };
        let plan = plan_update(&status, &detection, &test_config(), None).unwrap();
        assert!(matches!(plan.kind, PlanKind::ManualInstall { .. }));
    }
}
```

**Step 2: Implement planner/mod.rs**

Port the full planner logic from TypeScript including:
- `plan_update()`: main entry point
- `resolve_plan_kind()`: channel dispatch
- `resolve_native_channel()`, `resolve_unmanaged_channel()`, `resolve_npm_channel()`, `resolve_brew_channel()`
- `resolve_native_in_place()`: asset selection
- `resolve_post_action()`
- `select_asset()`, `expand_asset_pattern()`, `auto_match_asset()`
- `get_platform_aliases()`, `get_arch_aliases()`

Use `std::env::consts::OS` and `std::env::consts::ARCH` instead of `process.platform`/`process.arch`.

**Step 3: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 4: Commit**

```bash
git add rust/
git commit -m "feat(rust): add planner module with channel-based strategy resolution"
```

---

### Task 13: Applier - Verify (applier/verify.rs)

**Files:**
- Create: `rust/crates/update-kit/src/applier/mod.rs`
- Create: `rust/crates/update-kit/src/applier/verify.rs`
- Create: `rust/crates/update-kit/src/applier/types.rs`

**Reference:** `src/applier/verify.ts`

**Step 1: Write tests**

```rust
// applier/verify.rs tests
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs;

    #[tokio::test]
    async fn compute_sha256_correct() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.bin");
        fs::write(&file, b"hello world").await.unwrap();

        let hash = compute_sha256(&file).await.unwrap();
        // SHA-256 of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[tokio::test]
    async fn verify_checksum_match() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.bin");
        fs::write(&file, b"hello world").await.unwrap();

        let info = ChecksumInfo {
            expected_checksum: Some(
                "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9".into(),
            ),
            checksum_url: None,
        };
        verify_checksum(&file, &info, None).await.unwrap();
    }

    #[tokio::test]
    async fn verify_checksum_mismatch() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.bin");
        fs::write(&file, b"hello world").await.unwrap();

        let info = ChecksumInfo {
            expected_checksum: Some("0000".repeat(16)),
            checksum_url: None,
        };
        let result = verify_checksum(&file, &info, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn verify_missing_checksum_errors() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.bin");
        fs::write(&file, b"hello").await.unwrap();

        let info = ChecksumInfo {
            expected_checksum: None,
            checksum_url: None,
        };
        let result = verify_checksum(&file, &info, None).await;
        assert!(matches!(
            result,
            Err(UpdateKitError::ChecksumMissing(_))
        ));
    }
}
```

**Step 2: Implement verify.rs**

```rust
// rust/crates/update-kit/src/applier/verify.rs
use std::path::Path;
use sha2::{Sha256, Digest};
use tokio::io::AsyncReadExt;

use crate::errors::UpdateKitError;
use crate::utils::security::timing_safe_equal;

pub struct ChecksumInfo {
    pub expected_checksum: Option<String>,
    pub checksum_url: Option<String>,
}

pub struct VerifyOptions {
    pub filename: Option<String>,
}

pub async fn verify_checksum(
    file_path: &Path,
    checksum_info: &ChecksumInfo,
    options: Option<VerifyOptions>,
) -> Result<(), UpdateKitError> {
    let expected_hash = if let Some(ref checksum) = checksum_info.expected_checksum {
        checksum.to_lowercase()
    } else if let Some(ref url) = checksum_info.checksum_url {
        let filename = options
            .as_ref()
            .and_then(|o| o.filename.as_deref())
            .unwrap_or("artifact");
        fetch_checksum_from_url(url, filename).await?
    } else {
        return Err(UpdateKitError::ChecksumMissing(
            "No checksum provided. Use skip_checksum option or provide a checksum.".into(),
        ));
    };

    let actual_hash = compute_sha256(file_path).await?;

    if !timing_safe_equal(&actual_hash, &expected_hash) {
        return Err(UpdateKitError::ChecksumMismatch {
            expected: expected_hash,
            actual: actual_hash,
        });
    }

    Ok(())
}

pub async fn compute_sha256(file_path: &Path) -> Result<String, UpdateKitError> {
    let mut file = tokio::fs::File::open(file_path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 8192];

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

pub async fn fetch_checksum_from_url(
    checksum_url: &str,
    filename: &str,
) -> Result<String, UpdateKitError> {
    use crate::utils::security::require_https;
    require_https(checksum_url)?;

    let response = crate::utils::http::fetch_with_timeout(checksum_url, None).await?;

    if !response.status().is_success() {
        return Err(UpdateKitError::ChecksumFetchFailed(format!(
            "Failed to download checksum file: HTTP {}",
            response.status()
        )));
    }

    let text = response.text().await
        .map_err(|e| UpdateKitError::ChecksumFetchFailed(e.to_string()))?;

    let lines: Vec<&str> = text.trim().split('\n').collect();

    for line in &lines {
        // "sha256hash  filename" format
        if let Some((hash, name)) = line.split_once(char::is_whitespace) {
            let hash = hash.trim();
            let name = name.trim();
            if hash.len() == 64 && name == filename {
                return Ok(hash.to_lowercase());
            }
        }
    }

    // Single hash only
    if lines.len() == 1 {
        let hash = lines[0].trim();
        if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(hash.to_lowercase());
        }
    }

    Err(UpdateKitError::ChecksumParseFailed(format!(
        "Could not find hash for \"{filename}\" in checksum file."
    )))
}
```

**Step 3: Create applier/mod.rs and types.rs**

```rust
// rust/crates/update-kit/src/applier/mod.rs
pub mod native;
pub mod delegate;
pub mod types;
pub mod verify;
```

```rust
// rust/crates/update-kit/src/applier/types.rs
use crate::types::{ApplyProgress, DelegateMode};

pub struct ApplyOptions {
    pub on_progress: Option<Box<dyn Fn(ApplyProgress) + Send + Sync>>,
    pub skip_checksum: bool,
}

impl Default for ApplyOptions {
    fn default() -> Self {
        Self {
            on_progress: None,
            skip_checksum: false,
        }
    }
}

pub struct DelegateApplyOptions {
    pub mode: Option<DelegateMode>,
    pub timeout_ms: Option<u64>,
    pub on_progress: Option<Box<dyn Fn(ApplyProgress) + Send + Sync>>,
}
```

**Step 4: Update lib.rs**

Add `pub mod applier;` to lib.rs.

**Step 5: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 6: Commit**

```bash
git add rust/
git commit -m "feat(rust): add applier verify module (SHA-256 checksum verification)"
```

---

### Task 14: Applier - Native Update (applier/native.rs)

**Files:**
- Create: `rust/crates/update-kit/src/applier/native.rs`

**Reference:** `src/applier/native.ts`

**Step 1: Write tests for download, extract, and apply flow**

Test the individual helper functions: `download_artifact`, `extract_binary`, `find_binary_in_dir` using tempfile.

**Step 2: Implement native.rs**

The native update flow:
1. Create temp dir on same filesystem as target
2. Download artifact via streaming reqwest (with progress callback)
3. Verify checksum (unless skipped)
4. Extract archive (tar.gz via flate2+tar, zip via zip crate, or copy bare binary)
5. Find binary in extracted dir
6. Atomic replace via `platform::replace::atomic_replace`
7. Cleanup temp dir
8. Return `ApplyResult::Success` with post_action

**Step 3: Run tests**

Run: `cd rust && cargo test -p update-kit`

**Step 4: Commit**

```bash
git add rust/
git commit -m "feat(rust): add native update applier (download, extract, replace)"
```

---

### Task 15: Applier - Delegate Update (applier/delegate.rs)

**Files:**
- Create: `rust/crates/update-kit/src/applier/delegate.rs`

**Reference:** `src/applier/delegate.ts`

**Step 1: Write tests**

Test print-only mode returns message without executing. Test command safelist validation.

**Step 2: Implement delegate.rs**

Two modes:
- **Print-only**: Return instructions string without executing
- **Execute**: Spawn command, capture output, handle timeouts, detect permission errors

Implement command safelist: `["npm", "npx", "brew", "apt", "apt-get", "yum", "dnf", "choco", "winget", "scoop"]`

**Step 3: Run tests, commit**

```bash
git add rust/
git commit -m "feat(rust): add delegate update applier (print-only and execute modes)"
```

---

### Task 16: UX Module (ux/)

**Files:**
- Create: `rust/crates/update-kit/src/ux/mod.rs`
- Create: `rust/crates/update-kit/src/ux/colors.rs`
- Create: `rust/crates/update-kit/src/ux/banner.rs`
- Create: `rust/crates/update-kit/src/ux/progress.rs`

**Reference:** `src/ux/colors.ts`, `src/ux/index.ts`

**Step 1: Write tests**

```rust
// colors.rs tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_removes_codes() {
        let colored = "\x1b[1mhello\x1b[0m";
        assert_eq!(strip_ansi(colored), "hello");
    }

    #[test]
    fn bold_wraps_text() {
        let result = bold("test");
        assert!(result.contains("test"));
    }
}
```

**Step 2: Implement UX modules**

- `colors.rs`: ANSI escape code functions (bold, green, yellow, red, dim), `supports_color()`, `strip_ansi()`
- `banner.rs`: `render_banner()`, generates update notification banner string
- `progress.rs`: `render_progress()`, `render_result()`, human-readable progress/result strings

**Step 3: Run tests, commit**

```bash
git add rust/
git commit -m "feat(rust): add UX module (colors, banner, progress rendering)"
```

---

### Task 17: Main UpdateKit Struct (lib.rs)

**Files:**
- Modify: `rust/crates/update-kit/src/lib.rs` (add `UpdateKit` struct and public API)

**Reference:** `src/index.ts`

**Step 1: Write tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_update_kit_explicit() {
        let kit = UpdateKit::new(UpdateKitConfig::Explicit {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            base: BaseConfig::default(),
        });
        assert!(kit.is_ok());
    }

    #[test]
    fn create_update_kit_invalid_version() {
        let kit = UpdateKit::new(UpdateKitConfig::Explicit {
            app_name: "test-app".into(),
            current_version: "not-semver".into(),
            base: BaseConfig::default(),
        });
        assert!(kit.is_err());
    }

    #[test]
    fn plan_update_delegates_to_planner() {
        let kit = UpdateKit::new(UpdateKitConfig::Explicit {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            base: BaseConfig::default(),
        }).unwrap();

        let status = UpdateStatus::UpToDate { current: "1.0.0".into() };
        let detection = InstallDetection {
            channel: Channel::Native,
            confidence: Confidence::High,
            evidence: vec![],
        };
        assert!(kit.plan_update(&status, &detection).is_none());
    }
}
```

**Step 2: Implement UpdateKit struct**

```rust
pub struct UpdateKit {
    config: ResolvedConfig,
}

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

Port the full orchestration logic from `src/index.ts`:
- Config resolution and validation
- Source inference and channel-based ordering
- Hook execution (before_check, before_apply, after_apply, on_error)
- Error wrapping for all pipeline stages

**Step 3: Add public re-exports to lib.rs**

Re-export all public types, functions, and constants.

**Step 4: Run tests**

Run: `cd rust && cargo test -p update-kit`
Expected: All tests pass

**Step 5: Commit**

```bash
git add rust/
git commit -m "feat(rust): add UpdateKit struct with full pipeline orchestration"
```

---

### Task 18: CLI Binary (update-kit-cli)

**Files:**
- Modify: `rust/crates/update-kit-cli/src/main.rs`

**Reference:** `src/cli.ts`

**Step 1: Implement CLI with clap**

Subcommands: `detect`, `check`, `plan`, `apply`, `cache show`, `cache clear`, `doctor`

Each subcommand:
- Creates an `UpdateKit` instance from CLI args or config file
- Calls the appropriate method
- Outputs results as human-readable text or `--json` format

```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "update-kit", about = "CLI update toolkit")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Output as JSON
    #[arg(long, global = true)]
    json: bool,
}

#[derive(Subcommand)]
enum Commands {
    Detect,
    Check {
        #[arg(long, default_value = "blocking")]
        mode: String,
    },
    Plan,
    Apply,
    Cache {
        #[command(subcommand)]
        action: CacheAction,
    },
    Doctor,
}

#[derive(Subcommand)]
enum CacheAction {
    Show,
    Clear,
}
```

**Step 2: Run build**

Run: `cd rust && cargo build -p update-kit-cli`
Expected: Successful compilation

**Step 3: Commit**

```bash
git add rust/
git commit -m "feat(rust): add CLI binary with clap subcommands"
```

---

### Task 19: Integration Tests

**Files:**
- Create: `rust/crates/update-kit/tests/integration.rs`

**Step 1: Write integration tests**

Test the full pipeline with mocked HTTP (mockito):
- Config → detect → check (mocked GitHub API) → plan → verify plan correctness
- Cache write → read → stale detection

**Step 2: Run all tests**

Run: `cd rust && cargo test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add rust/
git commit -m "test(rust): add integration tests for full update pipeline"
```

---

### Task 20: Final Cleanup and Documentation

**Files:**
- Modify: `rust/crates/update-kit/src/lib.rs` (ensure all public API is properly exported)
- Modify: `rust/crates/update-kit/Cargo.toml` (verify metadata)

**Step 1: Verify full test suite**

Run: `cd rust && cargo test`
Run: `cd rust && cargo clippy -- -D warnings`
Run: `cd rust && cargo doc --no-deps`

**Step 2: Fix any clippy warnings or doc issues**

**Step 3: Final commit**

```bash
git add rust/
git commit -m "chore(rust): cleanup, clippy fixes, and documentation"
```

---

## Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Scaffold Cargo workspace | (none) |
| 2 | Core types (types.rs) | 1 |
| 3 | Error types (errors.rs) | 1 |
| 4 | Constants (constants.rs) | 1 |
| 5 | Config types (config.rs) | 2, 3, 4 |
| 6 | Platform utilities (paths, replace) | 3 |
| 7 | Utils (http, security, fs) | 3, 4 |
| 8 | Detection module | 2, 5, 6 |
| 9 | Checker cache | 3, 6 |
| 10 | Version sources (trait + 5 impls) | 5, 7 |
| 11 | Check orchestrator + inference | 9, 10 |
| 12 | Planner module | 2, 5, 10 |
| 13 | Applier verify (SHA-256) | 7 |
| 14 | Applier native | 6, 7, 13 |
| 15 | Applier delegate | 3 |
| 16 | UX module | 2 |
| 17 | UpdateKit struct | 8, 11, 12, 14, 15, 16 |
| 18 | CLI binary | 17 |
| 19 | Integration tests | 17 |
| 20 | Final cleanup | 19 |
