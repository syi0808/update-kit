# update-kit Rust API Reference

## Dependency

```toml
[dependencies]
update-kit = "0.1"
tokio = { version = "1", features = ["full"] }
```

Requires an async runtime (tokio). Key transitive dependencies: `reqwest`, `semver`, `serde`, `sha2`.

## Import

```rust
use update_kit::{UpdateKit, UpdateKitConfig, BaseConfig};
```

All key types are re-exported at the crate root.

## Creating an Instance

```rust
let kit = UpdateKit::new(UpdateKitConfig::Explicit {
    app_name: "my-cli".into(),
    current_version: "1.0.0".into(),
    base: BaseConfig {
        sources: Some(vec![VersionSourceConfig::Github {
            owner: "myorg".into(),
            repo: "my-cli".into(),
            token: None,
            api_base_url: None,
        }]),
        ..Default::default()
    },
})?;
```

Unlike the TypeScript API, Rust requires explicit `app_name` and `current_version` (no call-stack auto-detection). Use `UpdateKitConfig::Pkg` to supply a `PackageInfo` struct instead.

## Configuration

### UpdateKitConfig

```rust
pub enum UpdateKitConfig {
    Explicit {
        app_name: String,
        current_version: String,
        base: BaseConfig,
    },
    Pkg {
        app_name: Option<String>,       // Falls back to pkg.name
        current_version: Option<String>, // Falls back to pkg.version
        pkg: PackageInfo,
        base: BaseConfig,
    },
}
```

### BaseConfig

```rust
pub struct BaseConfig {
    // Detection
    pub repository: Option<String>,          // GitHub repo URL
    pub brew_cask_name: Option<String>,
    pub npm_package_name: Option<String>,

    // Check
    pub sources: Option<Vec<VersionSourceConfig>>,
    pub check_interval_ms: Option<u64>,      // Default: 72h
    pub check_mode: Option<CheckMode>,

    // Plan
    pub delegate_mode: Option<DelegateMode>, // Default: PrintOnly
    pub post_action: Option<PostAction>,
    pub min_confidence: Option<Confidence>,
    pub allow_reexec: Option<bool>,
    pub asset_pattern: Option<String>,       // Placeholders: {app}, {version}, {target}, {arch}, {ext}

    // Apply
    pub download_timeout_ms: Option<u64>,    // Default: 5min
    pub delegate_timeout_ms: Option<u64>,    // Default: 2min
    pub require_checksum: Option<bool>,
}
```

`BaseConfig` implements `Default` — all fields are `None`.

## Version Sources

```rust
pub enum VersionSourceConfig {
    Github { owner: String, repo: String, token: Option<String>, api_base_url: Option<String> },
    Npm { package_name: String, registry_url: Option<String> },
    Jsr { scope: String, name: String },
    Brew { cask_name: String },
    Custom { url: String, version_field: Option<String> },
}
```

Sources are tried in order; first success wins. When `sources` is omitted, they are auto-inferred from `repository`, `npm_package_name`, and `brew_cask_name`.

## Methods

### check_and_notify

```rust
pub async fn check_and_notify(&self) -> Result<Option<String>, UpdateKitError>
```

Non-blocking, cache-based check. Returns a styled banner string or `None`. Silently returns `Ok(None)` on any internal error.

### auto_update

```rust
pub async fn auto_update(&self, options: Option<ApplyOptions>) -> ApplyResult
```

Full pipeline: detect -> check (blocking) -> plan -> apply. Never panics. All errors wrapped in `ApplyResult::Failed`.

### detect_install

```rust
pub async fn detect_install(&self) -> Result<InstallDetection, UpdateKitError>
```

Returns `InstallDetection { channel, confidence, evidence }`.

### check_update

```rust
pub async fn check_update(&self, mode: CheckMode) -> Result<UpdateStatus, UpdateKitError>
```

- `CheckMode::Blocking` — Fetches from source now
- `CheckMode::NonBlocking` — Reads cache, spawns background refresh if stale

### plan_update

```rust
pub fn plan_update(&self, status: &UpdateStatus, detection: &InstallDetection) -> Option<UpdatePlan>
```

Synchronous. Returns `None` if status is not `Available`.

### apply_update

```rust
pub async fn apply_update(&self, plan: &UpdatePlan, options: Option<ApplyOptions>) -> ApplyResult
```

Executes the plan. Runs `before_apply`, `after_apply`, and `on_error` hooks.

### list_versions

```rust
pub async fn list_versions(&self, options: Option<FetchVersionsOptions>) -> Result<VersionListResult, UpdateKitError>
```

Lists available versions from the first source that supports it.

### switch_version

```rust
pub async fn switch_version(&self, target: &str, options: Option<ApplyOptions>) -> ApplyResult
```

Switches to a specific version (upgrade or downgrade). Never panics.

## Result Types (Enums)

### UpdateStatus

```rust
pub enum UpdateStatus {
    Available { current: String, latest: String, release_url: Option<String>, release_notes: Option<String>, assets: Option<Vec<AssetInfo>> },
    UpToDate { current: String },
    Unknown { reason: String, cached_latest: Option<String> },
}
```

### ApplyResult

```rust
pub enum ApplyResult {
    Success { from_version: String, to_version: String, post_action: PostAction },
    UpToDate { current: String },
    NeedsRestart { message: String },
    Failed { error: Box<UpdateKitError>, rollback_succeeded: bool },
}
```

### UpdatePlan

```rust
pub struct UpdatePlan {
    pub kind: PlanKind,
    pub from_version: String,
    pub to_version: String,
    pub post_action: PostAction,
}
```

### PlanKind

```rust
pub enum PlanKind {
    NativeInPlace { download_url: String, checksum_url: Option<String>, expected_checksum: Option<String> },
    DelegateCommand { channel: Channel, command: Vec<String>, mode: DelegateMode },
    ManualInstall { reason: String, instructions: String, download_url: Option<String> },
}
```

### InstallDetection

```rust
pub struct InstallDetection {
    pub channel: Channel,
    pub confidence: Confidence,
    pub evidence: Vec<Evidence>,
}
```

### Channel

```rust
pub enum Channel { Native, Unmanaged, NpmGlobal, BrewCask, Custom(String) }
```

### Confidence

```rust
pub enum Confidence { None, Low, Medium, High }
```

Implements `Ord` — can be compared with `<`, `>`, etc.

### PostAction

```rust
pub enum PostAction { SuggestRestart, ExitAfterApply, Reexec, None }
```

### DelegateMode

```rust
pub enum DelegateMode { PrintOnly, Execute }
```

## ApplyOptions

```rust
pub struct ApplyOptions {
    pub on_progress: Option<Box<dyn Fn(ApplyProgress) + Send + Sync>>,
    pub skip_checksum: bool,  // default: false
}
```

### ApplyProgress

```rust
pub enum ApplyProgress {
    Downloading { bytes_downloaded: u64, total_bytes: Option<u64> },
    Verifying,
    Extracting,
    Replacing,
    Executing { output: String, stream: OutputStream },
    Done,
}
```

## Hooks

```rust
pub struct Hooks {
    pub before_check: Option<BeforeCheckHook>,   // async () -> Result<(), UpdateKitError>
    pub before_apply: Option<BeforeApplyHook>,   // async (&UpdatePlan) -> Result<bool, UpdateKitError>
    pub after_apply: Option<AfterApplyHook>,     // async (&ApplyResult) -> Result<(), UpdateKitError>
    pub on_error: Option<OnErrorHook>,           // sync (&UpdateKitError) -> ()
}
```

Hook type aliases use `Pin<Box<dyn Future<...>>>` for async hooks. Create with closures:

```rust
let hooks = Hooks {
    before_check: Some(Box::new(|| Box::pin(async { Ok(()) }))),
    before_apply: Some(Box::new(|_plan| Box::pin(async { Ok(true) }))),
    on_error: Some(Box::new(|err| eprintln!("Error [{}]: {}", err.code(), err))),
    ..Default::default()
};
let kit = UpdateKit::with_hooks(config, hooks, None)?;
```

## Custom Detectors

```rust
pub struct CustomDetector {
    pub name: String,
    pub detect: DetectFn,  // async () -> Result<Option<InstallDetection>, UpdateKitError>
}
```

## Error Handling

```rust
use update_kit::UpdateKitError;
```

`UpdateKitError` is a `thiserror`-derived enum with a `.code()` method returning a static `&str`.

| Category | Codes |
|----------|-------|
| Detection | `DETECTION_FAILED` |
| Network | `NETWORK_ERROR`, `INSECURE_URL`, `DOWNLOAD_FAILED` |
| Cache | `CACHE_ERROR` |
| Version | `VERSION_PARSE` |
| Checksum | `CHECKSUM_MISMATCH`, `CHECKSUM_MISSING`, `CHECKSUM_FETCH_FAILED`, `CHECKSUM_PARSE_FAILED` |
| Apply | `APPLY_FAILED`, `EXTRACT_FAILED` |
| Commands | `COMMAND_FAILED`, `COMMAND_TIMEOUT`, `COMMAND_ABORTED`, `COMMAND_SPAWN_FAILED` |
| Platform | `UNSUPPORTED_PLATFORM`, `PERMISSION_DENIED`, `UNSUPPORTED_OPERATION` |
| IO | `IO_ERROR`, `JSON_ERROR` |

`check_and_notify()` silently returns `Ok(None)` on errors. `auto_update()` and `switch_version()` never panic — errors are returned as `ApplyResult::Failed`.

## Additional Types

### VersionInfo

```rust
pub struct VersionInfo {
    pub version: String,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
    pub assets: Option<Vec<AssetInfo>>,
    pub published_at: Option<String>,
}
```

### AssetInfo

```rust
pub struct AssetInfo {
    pub name: String,
    pub url: String,
    pub size: Option<u64>,
    pub checksum_url: Option<String>,
}
```

### FetchVersionsOptions

```rust
pub struct FetchVersionsOptions {
    pub limit: Option<usize>,    // Default: 20
    pub cursor: Option<String>,  // Opaque pagination cursor
}
```

### VersionListResult

```rust
pub enum VersionListResult {
    Success { versions: Vec<VersionInfo>, next_cursor: Option<String>, total_count: Option<usize> },
    Error { reason: String },
}
```

## Safety Policies

- HTTPS-only (rejects `http://` URLs with `INSECURE_URL` error)
- SHA-256 checksum verification by default
- Atomic file replacement (rename on Unix, backup+rollback on Windows)
- Never elevates privileges (no sudo)
- `DelegateCommand` defaults to `PrintOnly`
- Command execution validated against safelist (`npm`, `brew`, `apt`, etc.)
- Low-confidence detections produce `ManualInstall` plans (print-only)

## CLI

The `update-kit-cli` crate provides a binary with `clap`-based subcommands:

```bash
update-kit detect [--json]
update-kit check [--mode blocking|non-blocking] [--json]
update-kit plan [--json]
update-kit apply [--skip-checksum] [--json]
update-kit cache show|clear
update-kit doctor [--json]
```

Global flags: `--app-name`, `--current-version`, `--repository`, `--brew-cask-name`
