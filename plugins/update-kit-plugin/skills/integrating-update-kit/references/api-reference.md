# update-kit API Reference

## Import

```typescript
import { UpdateKit } from 'update-kit';
```

Dual ESM + CJS output. Requires Node.js >= 18. Only runtime dependency: `semver`.

## Creating an Instance

```typescript
const kit = await UpdateKit.create({
  sources: [{ type: 'github', owner: 'org', repo: 'my-cli' }],
});
```

`UpdateKit.create()` auto-detects `appName` and `currentVersion` from the caller's nearest `package.json` via call stack inspection.

## Configuration Options

```typescript
{
  // Identity (required, or use pkg / UpdateKit.create)
  appName: string,
  currentVersion: string,

  // Optional — Version checking
  sources: VersionSourceConfig[],    // Tried in order; first success wins
  checkInterval: number,             // Cache validity ms. Default: 72_000_000 (20h)
  cacheDir: string,                  // Default: OS-specific (~/.cache or %LOCALAPPDATA%)
  repository: string | { url: string }, // GitHub repo for auto-inferring sources

  // Optional — Detection
  npmPackageName: string,            // Override for npm-global detection/updates
  brewCaskName: string,              // Override for brew-cask detection/updates
  executablePath: string,            // Default: process.argv[1]
  customDetectors: CustomDetector[], // Custom channel detectors (checked before built-ins)

  // Optional — Planning
  delegateMode: 'print-only' | 'execute',  // Default: 'print-only'
  assetPattern: string,              // Placeholders: {app}, {version}, {target}, {arch}, {ext}
  customPlanResolver: (ctx: PlanResolverContext) => PlanKind | null,

  // Optional — Apply
  allowReexec: boolean,              // Re-exec new binary after native update. Default: false

  // Lifecycle hooks
  hooks: Hooks,
}
```

## Version Sources

| Type | Required Fields | Optional Fields |
|------|----------------|-----------------|
| `github` | `owner`, `repo` | `token`, `apiBaseUrl` (for GHE) |
| `npm` | `packageName` | `registryUrl` (default: `https://registry.npmjs.org`) |
| `jsr` | `scope` (no @), `name` | (none) |
| `brew` | `caskName` | (none) |
| `custom` | `url` | `versionField` (default: `"version"`, supports dot-notation e.g. `"data.latest.version"`) |

## Methods

### checkAndNotify(): Promise<string | null>

Non-blocking, cache-based check. Returns a styled banner string or null. **Never throws.** Uses `'non-blocking'` mode, reading from cache and spawning a background refresh if stale.

### autoUpdate(options?): Promise<ApplyResult>

Full pipeline: detect -> check (blocking) -> plan -> apply. **Never throws.** Returns structured `ApplyResult`.

### detectInstall(): Promise<InstallDetection>

Returns `{ channel, confidence, evidence[] }`.
- Channels: `'native'`, `'npm-global'`, `'brew-cask'`, `'unmanaged'`, or custom strings via `customDetectors`
- Confidence: `'none'`, `'low'`, `'medium'`, `'high'`

### checkUpdate(mode?): Promise<UpdateStatus>

- `'blocking'`: fetches from source now
- `'non-blocking'` (default): reads cache, spawns background refresh if stale

### planUpdate(status, detection): UpdatePlan | null

Synchronous. Returns null if status is not `'available'`.

### applyUpdate(plan, options?): Promise<ApplyResult>

Executes the plan. Runs `beforeApply`, `afterApply`, and `onError` hooks.

### listVersions(options?): Promise<VersionListResult>

Lists available versions with pagination. Iterates sources in channel-priority order; returns results from the first source that supports version listing. Does not throw.

Options: `{ limit?: number, cursor?: string, signal?: AbortSignal }`

### switchVersion(targetVersion, options?): Promise<ApplyResult>

Switches to a specific version (upgrade or downgrade). Runs the full pipeline: detect -> plan -> apply. **Never throws**; errors are returned as `{ kind: 'failed' }`.

Options: `{ execute?: boolean, assets?: AssetInfo[] } & ApplyOptions`

When `execute: true`, overrides `delegateMode` to `'execute'` for this operation.

## Result Types (Discriminated Unions)

### UpdateStatus (discriminated on `kind`)

```typescript
| { kind: 'available'; current: string; latest: string; releaseUrl?: string; releaseNotes?: string; assets?: AssetInfo[] }
| { kind: 'up-to-date'; current: string }
| { kind: 'unknown'; reason: string; cachedLatest?: string }
```

### ApplyResult (discriminated on `kind`)

```typescript
| { kind: 'success'; fromVersion: string; toVersion: string; postAction: PostAction }
| { kind: 'up-to-date'; current: string }
| { kind: 'needs-restart'; message: string }
| { kind: 'failed'; error: Error; rollbackSucceeded: boolean }
```

### UpdatePlan

```typescript
{
  kind: PlanKind;
  fromVersion: string;
  toVersion: string;
  postAction: PostAction;  // 'suggest-restart' | 'exit-after-apply' | 'reexec' | 'none'
}
```

### PlanKind (discriminated on `type`)

```typescript
| { type: 'native-in-place'; downloadUrl: string; checksumUrl?: string; expectedChecksum?: string }
| { type: 'delegate-command'; channel: Channel; command: string[]; mode: DelegateMode }
| { type: 'manual-install'; reason: string; instructions: string; downloadUrl?: string }
```

### InstallDetection

```typescript
{ channel: Channel; confidence: Confidence; evidence: Evidence[] }
```

## ApplyOptions

```typescript
{
  onProgress?: (progress: ApplyProgress) => void,
  signal?: AbortSignal,
  skipChecksum?: boolean,  // default: false
}
```

`ApplyProgress` phases: `'downloading'`, `'verifying'`, `'extracting'`, `'replacing'`, `'executing'`, `'done'`. The `'downloading'` phase includes `bytesDownloaded` and optional `totalBytes`. The `'executing'` phase includes `output` and `stream` (`'stdout'` | `'stderr'`) for delegate command output.

## Hooks

```typescript
{
  beforeCheck?: () => boolean | Promise<boolean>,         // false -> skip check
  beforeApply?: (plan: UpdatePlan) => boolean | Promise<boolean>,  // false -> skip apply
  afterApply?: (result: ApplyResult) => void | Promise<void>,
  onError?: (error: UpdateKitError) => void | Promise<void>,
}
```

## Error Handling

```typescript
import { UpdateKitError } from 'update-kit';
```

`UpdateKitError` extends `Error` with a `.code` string property. 19 error codes:

| Category | Codes |
|----------|-------|
| Detection | `DETECTION_FAILED` |
| Network | `NETWORK_ERROR`, `INSECURE_URL`, `DOWNLOAD_FAILED` |
| Cache | `CACHE_ERROR` |
| Version | `VERSION_PARSE` |
| Checksum | `CHECKSUM_MISMATCH`, `CHECKSUM_MISSING`, `CHECKSUM_FETCH_FAILED`, `CHECKSUM_PARSE_FAILED` |
| Signature | `SIGNATURE_INVALID` |
| Planning | `PLAN_REJECTED` |
| Apply | `APPLY_FAILED`, `EXTRACT_FAILED` |
| Commands | `COMMAND_FAILED`, `COMMAND_TIMEOUT`, `COMMAND_ABORTED`, `COMMAND_SPAWN_FAILED` |
| Platform | `UNSUPPORTED_PLATFORM`, `PERMISSION_DENIED` |

`checkAndNotify()` and `autoUpdate()` never throw. Use `hooks.onError` for observability.

## Safety Policies

- HTTPS-only (rejects `http://` URLs with `INSECURE_URL` error)
- SHA-256 checksum verification by default
- Atomic file replacement (rename on Unix, backup+rollback on Windows)
- Never elevates privileges (no sudo)
- `delegate-command` defaults to `'print-only'`
- Low-confidence detections produce `manual-install` plans (print-only)

## CLI

Config file: `update-kit.config.json`

```json
{
  "appName": "my-cli",
  "currentVersion": "1.0.0",
  "sources": [{ "type": "github", "owner": "myorg", "repo": "my-cli" }]
}
```

Commands: `update-kit detect`, `check`, `plan`, `apply`, `cache show`, `cache clear`, `doctor`. All support `--json`.

## Additional Types

### CustomDetector

```typescript
{
  name: string;
  detect: (execPath: string) => Promise<InstallDetection | null> | InstallDetection | null;
}
```

### PlanResolverContext

```typescript
{
  channel: Channel;
  confidence: Confidence;
  toVersion: string;
  config: ResolvedUpdateKitConfig;
  assets?: AssetInfo[];
  defaultPlan: PlanKind;
}
```

### VersionInfo

```typescript
{
  version: string;
  releaseUrl?: string;
  releaseNotes?: string;
  assets?: AssetInfo[];
  publishedAt?: string;
}
```

### AssetInfo

```typescript
{
  name: string;
  url: string;
  size?: number;
  checksumUrl?: string;
}
```

### VersionListResult (discriminated on `kind`)

```typescript
| { kind: 'success'; versions: VersionInfo[]; nextCursor?: string; totalCount?: number }
| { kind: 'error'; reason: string }
```

### FetchVersionsOptions

```typescript
{
  limit?: number;    // Default: 20
  cursor?: string;   // Opaque pagination cursor
  signal?: AbortSignal;
}
```

### MessageTemplates

Customizable UX templates for update messages. Override via `renderBanner(status, detection, templates)`.

```typescript
{
  updateAvailable: (ctx: { current: string; latest: string; command?: string }) => string;
  updateInProgress: (ctx: { phase: string; progress?: number }) => string;
  updateSuccess: (ctx: { version: string; postAction: PostAction }) => string;
  updateFailed: (ctx: { error: string }) => string;
  manualInstruction: (ctx: { instructions: string; downloadUrl?: string }) => string;
}
```

Import default templates: `import { defaultTemplates } from 'update-kit';`
