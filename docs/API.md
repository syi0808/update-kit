# API Reference

## Table of Contents

- [UpdateKit](#updatekit)
- [Configuration](#configuration)
  - [UpdateKitConfig](#updatekitconfig)
  - [Hooks](#hooks)
- [Types](#types)
  - [Detection Types](#detection-types)
  - [Version Check Types](#version-check-types)
  - [Planning Types](#planning-types)
  - [Apply Types](#apply-types)
- [Error Handling](#error-handling)
  - [UpdateKitError](#updatekiterror)
  - [Error Codes](#error-codes)
- [Version Sources](#version-sources)
  - [VersionSource Interface](#versionsource-interface)
  - [VersionSourceResult](#versionsourceresult)
  - [VersionInfo](#versioninfo)
  - [AssetInfo](#assetinfo)
  - [Source Configurations](#source-configurations)
  - [createVersionSource](#createversionsource)
- [Standalone Functions](#standalone-functions)
  - [detectInstall](#detectinstall)
  - [checkUpdate](#checkupdate)
  - [normalizeVersion](#normalizeversion)
  - [applyNativeUpdate](#applynativeupdate)
  - [applyDelegateUpdate](#applydelegateupdate)
  - [verifyChecksum](#verifychecksum)
  - [computeSha256](#computesha256)
  - [atomicReplace](#atomicreplace)
- [UX](#ux)
  - [renderBanner](#renderbanner)
  - [renderProgress](#renderprogress)
  - [renderResult](#renderresult)
  - [MessageTemplates](#messagetemplates)
  - [defaultTemplates](#defaulttemplates)
  - [Color Utilities](#color-utilities)
  - [runHook](#runhook)
- [Cache](#cache)
  - [CacheEntry](#cacheentry)

---

## UpdateKit

The main entry point. Orchestrates the full update pipeline: detection, checking, planning, and application.

```typescript
import { UpdateKit } from 'update-kit';
```

### Constructor

```typescript
new UpdateKit(config: UpdateKitConfig)
```

Creates a new UpdateKit instance. Throws if `appName` or `currentVersion` is missing or if `currentVersion` is not valid semver.

### Methods

#### `detectInstall()`

```typescript
async detectInstall(): Promise<InstallDetection>
```

Detects the installation channel of the running CLI app. Uses `process.execPath` internally.

#### `checkUpdate(mode?)`

```typescript
async checkUpdate(mode?: CheckMode): Promise<UpdateStatus>
```

Checks for available updates.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `CheckMode` | `'non-blocking'` | `'non-blocking'` returns cached results and spawns a background refresh. `'blocking'` fetches from sources directly. |

#### `planUpdate(status, detection)`

```typescript
planUpdate(status: UpdateStatus, detection: InstallDetection): UpdatePlan | null
```

Creates an update plan based on version status and installation detection. Returns `null` if no update is needed.

#### `applyUpdate(plan, options?)`

```typescript
async applyUpdate(plan: UpdatePlan, options?: ApplyOptions): Promise<ApplyResult>
```

Applies an update plan. Calls `beforeApply` and `afterApply` hooks. On error, calls the `onError` hook.

#### `checkAndNotify()`

```typescript
async checkAndNotify(): Promise<string | null>
```

One-liner for app startup. Performs a non-blocking check and returns a colored banner string if an update is available, or `null` otherwise. Never throws.

#### `autoUpdate(options?)`

```typescript
async autoUpdate(options?: ApplyOptions): Promise<ApplyResult>
```

Runs the full pipeline: detect → check (blocking) → plan → apply. Never throws; errors are returned as `{ kind: 'failed' }`.

---

## Configuration

### UpdateKitConfig

```typescript
interface UpdateKitConfig {
  appName: string;
  currentVersion: string;
  sources?: VersionSourceConfig[];
  checkInterval?: number;
  cacheDir?: string;
  delegateMode?: DelegateMode;
  npmPackageName?: string;
  brewCaskName?: string;
  allowReexec?: boolean;
  assetPattern?: string;
  hooks?: Hooks;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `appName` | `string` | **required** | Application name (e.g. `"my-cli"`) |
| `currentVersion` | `string` | **required** | Currently installed version (semver) |
| `sources` | `VersionSourceConfig[]` | `[]` | Version sources, tried in order; first success wins |
| `checkInterval` | `number` | `72_000_000` (20h) | Cache validity interval in milliseconds |
| `cacheDir` | `string` | OS-specific | Cache directory path. Defaults to `XDG_CACHE_HOME`, `~/Library/Caches`, or `APPDATA` |
| `delegateMode` | `DelegateMode` | `'print-only'` | Whether delegate commands are printed or executed |
| `npmPackageName` | `string` | — | npm package name for detection and updates |
| `brewCaskName` | `string` | — | Homebrew cask name for detection and updates |
| `allowReexec` | `boolean` | `false` | Whether to re-execute the new binary after update |
| `assetPattern` | `string` | — | Asset filename pattern with placeholders: `{app}`, `{version}`, `{target}`, `{arch}`, `{ext}` |
| `hooks` | `Hooks` | — | Lifecycle hooks |

### Hooks

```typescript
interface Hooks {
  beforeCheck?: () => boolean | Promise<boolean>;
  beforeApply?: (plan: UpdatePlan) => boolean | Promise<boolean>;
  afterApply?: (result: ApplyResult) => void | Promise<void>;
  onError?: (error: UpdateKitError) => void | Promise<void>;
}
```

| Hook | Parameters | Return | Description |
|------|-----------|--------|-------------|
| `beforeCheck` | — | `boolean` | Called before version check. Return `false` to skip. |
| `beforeApply` | `plan: UpdatePlan` | `boolean` | Called before applying an update. Return `false` to skip. |
| `afterApply` | `result: ApplyResult` | `void` | Called after applying, regardless of success or failure. |
| `onError` | `error: UpdateKitError` | `void` | Called on error. Useful for telemetry or logging. |

---

## Types

All types are importable from the package root:

```typescript
import type { Channel, UpdateStatus, ApplyResult /* ... */ } from 'update-kit';
```

### Detection Types

#### `Channel`

```typescript
type Channel = 'native' | 'unmanaged' | 'npm-global' | 'brew-cask' | (string & {});
```

Install channel identifier. Accepts known channels and arbitrary custom strings.

#### `Confidence`

```typescript
type Confidence = 'none' | 'low' | 'medium' | 'high';
```

Detection confidence level.

#### `Evidence`

```typescript
interface Evidence {
  source: string;  // e.g. "path_pattern", "receipt_file", "brew_list"
  detail: string;
}
```

#### `InstallDetection`

```typescript
interface InstallDetection {
  channel: Channel;
  confidence: Confidence;
  evidence: Evidence[];
}
```

### Version Check Types

#### `CheckMode`

```typescript
type CheckMode = 'blocking' | 'non-blocking';
```

- `'blocking'` — Fetches from sources directly and updates the cache.
- `'non-blocking'` — Returns cached result immediately; spawns a background refresh if stale.

#### `UpdateStatus`

Discriminated union on `kind`:

```typescript
type UpdateStatus =
  | { kind: 'available'; current: string; latest: string; releaseUrl?: string; releaseNotes?: string }
  | { kind: 'up-to-date'; current: string }
  | { kind: 'unknown'; reason: string; cachedLatest?: string };
```

| Variant | Description |
|---------|-------------|
| `available` | A newer version exists. Includes `current`, `latest`, and optional release metadata. |
| `up-to-date` | The current version matches or exceeds the latest. |
| `unknown` | Version could not be determined. `reason` explains why. |

### Planning Types

#### `DelegateMode`

```typescript
type DelegateMode = 'print-only' | 'execute';
```

- `'print-only'` — Shows the command to the user without executing it (default).
- `'execute'` — Runs the command directly.

#### `PostAction`

```typescript
type PostAction = 'suggest-restart' | 'exit-after-apply' | 'reexec' | 'none';
```

#### `PlanKind`

Discriminated union on `type`:

```typescript
type PlanKind =
  | { type: 'native-in-place'; downloadUrl: string; checksumUrl?: string; expectedChecksum?: string }
  | { type: 'delegate-command'; channel: Channel; command: string[]; mode: DelegateMode }
  | { type: 'manual-install'; reason: string; instructions: string; downloadUrl?: string };
```

| Variant | Description |
|---------|-------------|
| `native-in-place` | Download binary, verify checksum, extract, and atomically replace. |
| `delegate-command` | Print or execute a package manager command (npm, brew, etc.). |
| `manual-install` | Show instructions for manual update. Fallback for low-confidence detections. |

#### `UpdatePlan`

```typescript
interface UpdatePlan {
  kind: PlanKind;
  fromVersion: string;
  toVersion: string;
  postAction: PostAction;
}
```

### Apply Types

#### `ApplyProgress`

Discriminated union on `phase`:

```typescript
type ApplyProgress =
  | { phase: 'downloading'; bytesDownloaded: number; totalBytes?: number }
  | { phase: 'verifying' }
  | { phase: 'extracting' }
  | { phase: 'replacing' }
  | { phase: 'done' };
```

#### `ApplyResult`

Discriminated union on `kind`:

```typescript
type ApplyResult =
  | { kind: 'success'; fromVersion: string; toVersion: string; postAction: PostAction }
  | { kind: 'needs-restart'; message: string }
  | { kind: 'failed'; error: Error; rollbackSucceeded: boolean };
```

#### `ApplyOptions`

```typescript
interface ApplyOptions {
  onProgress?: (progress: ApplyProgress) => void;
  signal?: AbortSignal;
  skipChecksum?: boolean;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `onProgress` | `(progress: ApplyProgress) => void` | — | Callback fired at each phase transition and during download |
| `signal` | `AbortSignal` | — | Cancellation signal |
| `skipChecksum` | `boolean` | `false` | Skip checksum verification (not recommended) |

#### `DelegateApplyOptions`

Extends `ApplyOptions`:

```typescript
interface DelegateApplyOptions extends ApplyOptions {
  mode?: DelegateMode;
  timeoutMs?: number;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `DelegateMode` | `'print-only'` | Whether to print or execute the command |
| `timeoutMs` | `number` | `120_000` | Command execution timeout in milliseconds |

#### `DelegateApplyResult`

```typescript
interface DelegateApplyResult {
  kind: 'success';
  fromVersion: string;
  toVersion: string;
  postAction: PostAction;
  command: string[];
  stdout?: string;   // execute mode only
  stderr?: string;   // execute mode only
  message?: string;  // print-only mode
}
```

---

## Error Handling

### UpdateKitError

```typescript
import { UpdateKitError } from 'update-kit';
```

Extends `Error` with a structured `code` field for programmatic error handling.

```typescript
class UpdateKitError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: Error });
}
```

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `code` | `string` | One of the error code constants below |
| `name` | `string` | Always `'UpdateKitError'` |
| `message` | `string` | Human-readable error description |
| `cause` | `Error \| undefined` | Original error, if wrapped |

### Error Codes

All error codes are exported as string constants and as the `ErrorCode` union type.

```typescript
import { CHECKSUM_MISMATCH, type ErrorCode } from 'update-kit';
```

| Constant | Value | Description |
|----------|-------|-------------|
| `DETECTION_FAILED` | `'DETECTION_FAILED'` | Install channel detection failed |
| `NETWORK_ERROR` | `'NETWORK_ERROR'` | Network request failed (timeout, DNS, etc.) |
| `CACHE_ERROR` | `'CACHE_ERROR'` | Cache read/write failure |
| `VERSION_PARSE` | `'VERSION_PARSE'` | Version string parse failure |
| `CHECKSUM_MISMATCH` | `'CHECKSUM_MISMATCH'` | Downloaded file checksum does not match |
| `CHECKSUM_MISSING` | `'CHECKSUM_MISSING'` | No checksum provided and `skipChecksum` is false |
| `CHECKSUM_FETCH_FAILED` | `'CHECKSUM_FETCH_FAILED'` | Failed to download checksum file from URL |
| `CHECKSUM_PARSE_FAILED` | `'CHECKSUM_PARSE_FAILED'` | Checksum file could not be parsed or filename not found |
| `SIGNATURE_INVALID` | `'SIGNATURE_INVALID'` | Signature verification failed |
| `INSECURE_URL` | `'INSECURE_URL'` | HTTP URL rejected (HTTPS required) |
| `DOWNLOAD_FAILED` | `'DOWNLOAD_FAILED'` | HTTP error or empty response during download |
| `EXTRACT_FAILED` | `'EXTRACT_FAILED'` | Archive extraction failure |
| `PERMISSION_DENIED` | `'PERMISSION_DENIED'` | Insufficient file system permissions |
| `UNSUPPORTED_PLATFORM` | `'UNSUPPORTED_PLATFORM'` | Feature not supported on current platform |
| `PLAN_REJECTED` | `'PLAN_REJECTED'` | User or hook rejected the update plan |
| `APPLY_FAILED` | `'APPLY_FAILED'` | Update application failed |
| `COMMAND_FAILED` | `'COMMAND_FAILED'` | External command execution failed |
| `COMMAND_TIMEOUT` | `'COMMAND_TIMEOUT'` | Delegate command exceeded timeout |
| `COMMAND_ABORTED` | `'COMMAND_ABORTED'` | Delegate command cancelled via AbortSignal |
| `COMMAND_SPAWN_FAILED` | `'COMMAND_SPAWN_FAILED'` | Delegate command spawn failed (e.g. binary not found) |

---

## Version Sources

### VersionSource Interface

```typescript
interface VersionSource {
  name: string;
  fetchLatest(options?: { etag?: string; signal?: AbortSignal }): Promise<VersionSourceResult>;
}
```

Plugin interface for fetching the latest version from an external registry.

### VersionSourceResult

Discriminated union on `kind`:

```typescript
type VersionSourceResult =
  | { kind: 'found'; info: VersionInfo; etag?: string }
  | { kind: 'not-modified'; etag: string }
  | { kind: 'error'; reason: string };
```

### VersionInfo

```typescript
interface VersionInfo {
  version: string;
  releaseUrl?: string;
  releaseNotes?: string;
  assets?: AssetInfo[];
  publishedAt?: string;  // ISO 8601
}
```

### AssetInfo

```typescript
interface AssetInfo {
  name: string;
  url: string;
  size?: number;
  checksumUrl?: string;
}
```

### Source Configurations

#### GitHubSourceConfig

```typescript
interface GitHubSourceConfig {
  type: 'github';
  owner: string;           // Repository owner
  repo: string;            // Repository name
  token?: string;          // GitHub API token (for rate limit avoidance)
  apiBaseUrl?: string;     // API base URL (for GitHub Enterprise)
}
```

#### NpmSourceConfig

```typescript
interface NpmSourceConfig {
  type: 'npm';
  packageName: string;     // npm package name
  registryUrl?: string;    // Default: https://registry.npmjs.org
}
```

#### JsrSourceConfig

```typescript
interface JsrSourceConfig {
  type: 'jsr';
  scope: string;           // Scope without @ (e.g. "std")
  name: string;            // Package name
}
```

#### BrewSourceConfig

```typescript
interface BrewSourceConfig {
  type: 'brew';
  caskName: string;        // Homebrew cask name
}
```

#### CustomManifestSourceConfig

```typescript
interface CustomManifestSourceConfig {
  type: 'custom';
  url: string;             // Manifest JSON URL
  versionField?: string;   // Default: "version". Supports dot-notation (e.g. "data.latest.version")
}
```

### createVersionSource

```typescript
function createVersionSource(config: VersionSourceConfig): VersionSource
```

Factory function that creates the appropriate `VersionSource` implementation based on `config.type`. Throws for unknown types.

---

## Standalone Functions

These functions are exported individually for advanced use cases where you need direct access to specific pipeline stages.

### detectInstall

```typescript
import { detectInstall } from 'update-kit';

async function detectInstall(
  execPath: string,
  config: Pick<UpdateKitConfig, 'appName' | 'brewCaskName'>,
): Promise<InstallDetection>
```

Detects the installation channel. Detection priority:

1. Install receipt (explicit record)
2. Homebrew patterns (path + command verification)
3. npm global patterns (path + prefix + symlink)
4. Fallback: `unmanaged`

### checkUpdate

```typescript
import { checkUpdate } from 'update-kit';

async function checkUpdate(
  config: CheckUpdateOptions,
  mode: CheckMode,
): Promise<UpdateStatus>
```

#### CheckUpdateOptions

```typescript
interface CheckUpdateOptions {
  appName: string;
  currentVersion: string;
  sources: VersionSource[];
  cacheDir: string;
  checkInterval?: number;  // Default: 72_000_000
}
```

### normalizeVersion

```typescript
import { normalizeVersion } from 'update-kit';

function normalizeVersion(version: string): string | null
```

Normalizes a version string to `major.minor.patch`. Strips pre-release tags and build metadata. Falls back to `semver.coerce` for partial or non-standard version strings. Returns `null` if unparseable.

### applyNativeUpdate

```typescript
import { applyNativeUpdate } from 'update-kit';

async function applyNativeUpdate(
  plan: UpdatePlan,
  targetPath: string,
  options?: ApplyOptions,
): Promise<ApplyResult>
```

Applies a `native-in-place` plan: download → verify → extract → atomic replace. Throws if `plan.kind.type` is not `'native-in-place'`.

### applyDelegateUpdate

```typescript
import { applyDelegateUpdate } from 'update-kit';

async function applyDelegateUpdate(
  plan: UpdatePlan,
  options?: DelegateApplyOptions,
): Promise<DelegateApplyResult>
```

Applies a `delegate-command` plan. In `print-only` mode, returns the command string. In `execute` mode, spawns the process with timeout and abort support.

Allowed commands: `npm`, `npx`, `brew`, `apt`, `apt-get`, `yum`, `dnf`, `choco`, `winget`, `scoop`.

### verifyChecksum

```typescript
import { verifyChecksum } from 'update-kit';

async function verifyChecksum(
  filePath: string,
  checksumInfo: ChecksumInfo,
  options?: { filename?: string; signal?: AbortSignal },
): Promise<void>
```

Verifies a file's SHA-256 checksum. Accepts either a direct `expectedChecksum` hex string or a `checksumUrl` to fetch. Throws `CHECKSUM_MISMATCH` on mismatch, `CHECKSUM_MISSING` if no checksum is provided.

#### ChecksumInfo

```typescript
interface ChecksumInfo {
  expectedChecksum?: string;  // SHA-256 hex string
  checksumUrl?: string;       // URL to a checksum file (e.g. SHA256SUMS)
}
```

### computeSha256

```typescript
import { computeSha256 } from 'update-kit';

async function computeSha256(filePath: string): Promise<string>
```

Computes the SHA-256 hash of a file using streaming. Returns a lowercase hex string.

### atomicReplace

```typescript
import { atomicReplace } from 'update-kit';

async function atomicReplace(newPath: string, targetPath: string): Promise<void>
```

Atomically replaces the target binary with a new file.

- **Unix**: Copy to same-directory temp file, then `rename` (atomic on same filesystem).
- **Windows**: Rename target to `.old`, copy new to target, clean up `.old`. Rolls back on failure.

Throws `PERMISSION_DENIED` if the target is not writable.

---

## UX

### renderBanner

```typescript
import { renderBanner } from 'update-kit';

function renderBanner(
  status: UpdateStatus,
  detection: InstallDetection,
  config?: Partial<MessageTemplates>,
): string | null
```

Returns a colored "update available" banner string, or `null` if no update is available. Includes version numbers and the appropriate update command for the detected channel.

### renderProgress

```typescript
import { renderProgress } from 'update-kit';

function renderProgress(progress: ApplyProgress): string
```

Returns a human-readable progress message for the current apply phase.

### renderResult

```typescript
import { renderResult } from 'update-kit';

function renderResult(result: ApplyResult): string
```

Returns a colored result message: green for success, yellow for needs-restart, red for failure.

### MessageTemplates

```typescript
interface MessageTemplates {
  updateAvailable: (ctx: { current: string; latest: string; command?: string }) => string;
  updateInProgress: (ctx: { phase: string; progress?: number }) => string;
  updateSuccess: (ctx: { version: string; postAction: PostAction }) => string;
  updateFailed: (ctx: { error: string }) => string;
  manualInstruction: (ctx: { instructions: string; downloadUrl?: string }) => string;
}
```

All template functions can be overridden by passing a partial `MessageTemplates` object to `renderBanner` or by providing custom templates.

### defaultTemplates

```typescript
import { defaultTemplates } from 'update-kit';
```

The built-in message templates. Can be spread and overridden:

```typescript
const customTemplates = {
  ...defaultTemplates,
  updateAvailable({ current, latest }) {
    return `New version ${latest} is available (current: ${current})`;
  },
};
```

### Color Utilities

```typescript
import { supportsColor, bold, red, green, yellow, dim, stripAnsi } from 'update-kit';
```

| Function | Signature | Description |
|----------|-----------|-------------|
| `supportsColor` | `() => boolean` | Returns `true` if stdout is a TTY and `NO_COLOR` is not set |
| `bold` | `(text: string) => string` | Wraps text in ANSI bold |
| `red` | `(text: string) => string` | Wraps text in ANSI red |
| `green` | `(text: string) => string` | Wraps text in ANSI green |
| `yellow` | `(text: string) => string` | Wraps text in ANSI yellow |
| `dim` | `(text: string) => string` | Wraps text in ANSI dim |
| `stripAnsi` | `(text: string) => string` | Removes all ANSI escape codes from a string |

All color functions are no-ops when `supportsColor()` returns `false`.

### runHook

```typescript
import { runHook } from 'update-kit';

async function runHook<K extends keyof Hooks>(
  hooks: Hooks | undefined,
  name: K,
  ...args: Parameters<NonNullable<Hooks[K]>>
): Promise<ReturnType<NonNullable<Hooks[K]>> | true>
```

Executes a lifecycle hook by name. Returns `true` if the hook is not defined. Used internally by `UpdateKit` but available for advanced usage.

---

## Cache

### CacheEntry

```typescript
import type { CacheEntry } from 'update-kit';

interface CacheEntry {
  latestVersion: string;
  currentVersionAtCheck: string;
  lastCheckedAt: string;       // ISO 8601
  source: string;              // e.g. "github", "npm"
  etag?: string;
  releaseUrl?: string;
  releaseNotes?: string;
}
```

Represents a cached version check result persisted to disk. The cache file is stored at `{cacheDir}/{appName}/update-check.json`.
