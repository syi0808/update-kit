# E2E Test Suite Design

## Overview

Add comprehensive E2E tests that cover real integration environments using fixtures. Tests exercise the actual built artifacts (`dist/`) with real filesystem operations, mock binaries on PATH, and fetch API mocking — no `vi.mock()` on internal modules.

**Two levels:**
- **API E2E**: Import `UpdateKit` from dist, run full pipelines against fixture environments
- **CLI E2E**: Execute `dist/cli.mjs` as child process, verify stdout/stderr/exit codes

**Total: ~135 test cases** (API 99 + CLI 36)

---

## File Structure

```
tests/e2e/
├── vitest.config.ts
├── helpers/
│   ├── environment.ts         # createTestEnvironment()
│   ├── fetch-mock.ts          # setupFetchMock()
│   ├── cli-runner.ts          # runCLI()
│   ├── cli-bootstrap.mjs     # CLI process fetch mock injection
│   ├── artifacts.ts           # createTestArtifacts()
│   └── mock-command.sh        # Universal mock binary script
├── fixtures/
│   └── servers/               # Fetch mock response JSON files
│       ├── github-latest.json
│       ├── github-no-assets.json
│       ├── npm-registry.json
│       ├── jsr-package.json
│       ├── brew-cask.json
│       └── custom-manifest.json
├── api/
│   ├── detection.e2e.test.ts  # Channel detection (8 cases)
│   ├── check.e2e.test.ts      # Version checking (11 cases)
│   ├── plan.e2e.test.ts       # Plan generation (14 cases)
│   ├── apply.e2e.test.ts      # Update application (15 cases)
│   ├── pipeline.e2e.test.ts   # Full pipeline: checkAndNotify + autoUpdate (14 cases)
│   ├── hooks.e2e.test.ts      # Hook system (7 cases)
│   ├── custom.e2e.test.ts     # Custom channels/resolvers (5 cases)
│   ├── errors.e2e.test.ts     # Error scenarios (17 cases)
│   └── safety.e2e.test.ts     # Safety policy verification (6 cases)
└── cli/
    ├── detect.e2e.test.ts     # detect subcommand (7 cases)
    ├── check.e2e.test.ts      # check subcommand (6 cases)
    ├── plan.e2e.test.ts       # plan subcommand (6 cases)
    ├── apply.e2e.test.ts      # apply subcommand (5 cases)
    ├── cache.e2e.test.ts      # cache subcommand (4 cases)
    ├── doctor.e2e.test.ts     # doctor subcommand (4 cases)
    └── errors.e2e.test.ts     # CLI error handling (4 cases)
```

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | API + CLI levels | Both are public interfaces for integrators |
| Network I/O | fetch API mock (`vi.stubGlobal`) | Deterministic, CI-stable |
| Filesystem | Real temp directories (`fs.mkdtemp`) for both API and CLI | dist modules use `node:fs` directly; memfs cannot intercept without `vi.mock()` |
| child_process | Mock binary scripts + PATH manipulation | Real process spawning, deterministic output |
| Channel coverage | All: native, npm-global, brew-cask, unmanaged, apt, choco, custom | Thorough coverage as requested |
| Test location | `tests/e2e/` with separate vitest config | Isolated from unit tests, separate run |
| Test target | Built dist output | Tests what integrators actually consume |
| Process isolation | `pool: 'forks'` | Prevents fetch mock collisions between files |

---

## Helpers

### 1. `createTestEnvironment()`

Factory that builds a complete test environment for a given channel.

```typescript
interface TestEnvironment {
  tmpDir: string;
  binDir: string;
  appDir: string;
  cachePath: string;
  executablePath: string;
  configPath: string;
  callLogPath: string;
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

async function createTestEnvironment(options: {
  channel: "native" | "npm-global" | "brew-cask" | "unmanaged" | "apt" | "choco" | "custom";
  currentVersion?: string;     // default: "1.0.0"
  configOverrides?: Partial<UpdateKitConfig>;
  mockBinBehavior?: Record<string, {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    delayMs?: number;
  }>;
}): Promise<TestEnvironment>
```

**Channel-specific setup:**

| Channel | executablePath layout | Mock bin config |
|---------|----------------------|-----------------|
| native | `tmpDir/app/test-app` + install-receipt.json in config dir | Not needed |
| npm-global | `tmpDir/lib/node_modules/.bin/test-app` (symlink) | npm: stdout=`tmpDir/lib` |
| brew-cask | `tmpDir/opt/homebrew/bin/test-app` | brew: `list --cask` → exitCode=0 |
| unmanaged | `tmpDir/somewhere/test-app` | Not needed |
| apt | customDetector + customPlanResolver provided (apt is not a built-in channel) | apt: exitCode=0 |
| choco | customDetector + customPlanResolver provided (choco is not a built-in channel) | choco: exitCode=0 |
| custom | customDetector provided, optional customPlanResolver | Optional |

### 2. `setupFetchMock()`

Route-based fetch interceptor.

```typescript
interface FetchMockRoute {
  url: string | RegExp;
  method?: string;
  response: {
    status?: number;
    headers?: Record<string, string>;
    body?: string | Buffer | object;
    bodyPath?: string;           // Path relative to fixtures/servers/
  };
}

function setupFetchMock(routes: FetchMockRoute[]): {
  restore(): void;
  calls(): { url: string; method: string; headers: Headers }[];
}
```

- Unmatched URLs throw an error (prevents accidental external requests)
- Records all calls for assertion
- `restore()` reinstates original fetch

### 3. `runCLI()`

Executes CLI as child process with fetch mock injection.

```typescript
interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCLI(options: {
  args: string[];
  env: TestEnvironment;
  timeout?: number;            // default: 10_000
}): Promise<CLIResult>
```

Runs: `node --import tests/e2e/helpers/cli-bootstrap.mjs dist/cli.mjs <args>`

The bootstrap script (`cli-bootstrap.mjs`) intercepts `globalThis.fetch` inside the CLI process, reading mock responses from the directory specified by `FETCH_MOCK_DIR` environment variable.

**CLI fetch mock URL mapping convention:**
The `FETCH_MOCK_DIR` directory contains a `routes.json` manifest file that maps URL patterns to response files:
```json
[
  { "url": "api.github.com/repos/.*/releases/latest", "file": "github-latest.json", "status": 200 },
  { "url": "registry.npmjs.org/.*", "file": "npm-registry.json", "status": 200 },
  { "url": ".*\\.tar\\.gz$", "file": "app-v2.0.0-darwin-arm64.tar.gz", "binary": true },
  { "url": ".*SHA256SUMS$", "file": "SHA256SUMS" }
]
```
The bootstrap script reads this manifest, compiles URL patterns to RegExp, and intercepts `globalThis.fetch` accordingly. Unmatched URLs throw an error.

### 4. `createTestArtifacts()`

Generates real downloadable artifacts at test setup time.

```typescript
async function createTestArtifacts(dir: string): Promise<void>
```

Creates:
- `app-v2.0.0-darwin-arm64.tar.gz` — tar.gz containing a small shell script "binary"
- `app-v2.0.0-linux-x64.zip` — zip variant
- `app-v2.0.0-bare` — uncompressed binary
- `SHA256SUMS` — real SHA-256 hashes computed from the artifacts

### 5. Mock Binary (`mock-command.sh`)

Universal mock script for all package managers.

```bash
#!/bin/sh
echo "$0 $*" >> "${MOCK_CALL_LOG}"
if [ -n "$MOCK_DELAY_MS" ]; then
  sleep $(echo "$MOCK_DELAY_MS / 1000" | bc -l)
fi
[ -n "$MOCK_STDOUT" ] && echo "$MOCK_STDOUT"
[ -n "$MOCK_STDERR" ] && echo "$MOCK_STDERR" >&2
exit "${MOCK_EXIT_CODE:-0}"
```

Symlinked as `brew`, `npm`, `apt`, `yum`, `choco`, `winget`, `scoop` in the test bin directory. Behavior controlled via environment variables. Call log enables assertion on invocation arguments.

---

## Vitest Configuration

```typescript
// tests/e2e/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'tests/e2e',
    include: ['**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    pool: 'forks',
    globals: true,
  }
});
```

**package.json script:**
```json
{
  "test:e2e": "pnpm build && vitest run --config tests/e2e/vitest.config.ts"
}
```

---

## Test Scenarios

### API Level

#### `api/detection.e2e.test.ts` — Channel Detection (8 cases)

| # | Scenario | Channel | Expected |
|---|----------|---------|----------|
| 1 | install-receipt exists | native | high confidence |
| 2 | /opt/homebrew/ path + brew list succeeds | brew-cask | high confidence |
| 3 | /opt/homebrew/ path + brew list fails | brew-cask | medium confidence |
| 4 | node_modules/.bin/ path + npm prefix matches | npm-global | high confidence |
| 5 | node_modules/.bin/ path + npm prefix mismatch | npm-global | medium confidence |
| 6 | No pattern matches | unmanaged | low confidence |
| 7 | customDetector matches first | custom | customDetector result takes priority |
| 8 | Multiple detectors could match | - | Priority order verified |

#### `api/check.e2e.test.ts` — Version Checking (11 cases)

| # | Scenario | Mode | Expected |
|---|----------|------|----------|
| 1 | GitHub source, newer version | blocking | kind: "available" |
| 2 | npm source, same version | blocking | kind: "up-to-date" |
| 3 | JSR source, newer version | blocking | kind: "available" |
| 4 | Brew source | blocking | kind: "available" |
| 5 | Custom manifest | blocking | kind: "available" |
| 6 | Fresh cache exists | non-blocking | Immediate return from cache |
| 7 | Stale cache exists | non-blocking | Cache return + background spawn |
| 8 | No cache | non-blocking | kind: "unknown" |
| 9 | All sources fail | blocking | kind: "unknown" + reason |
| 10 | ETag 304 response | blocking | Cache reused |
| 11 | Source fallback order | blocking | First fails → second succeeds |

#### `api/plan.e2e.test.ts` — Plan Generation (14 cases)

| # | Scenario | Channel/Confidence | Expected plan type |
|---|----------|-------------------|-------------------|
| 1 | native + high + assets | native/high | native-in-place |
| 2 | native + low | native/low | manual-install |
| 3 | npm-global + high | npm-global/high | delegate-command (npm) |
| 4 | npm-global + low | npm-global/low | manual-install |
| 5 | brew-cask + high | brew-cask/high | delegate-command (brew) |
| 6 | unmanaged + assets | unmanaged/low | native-in-place |
| 7 | unmanaged + no assets + none confidence | unmanaged/none | manual-install |
| 8 | apt + high (via customPlanResolver) | apt/high | delegate-command (apt) |
| 9 | choco + high (via customPlanResolver) | choco/high | delegate-command (choco) |
| 10 | customPlanResolver overrides | any | resolver return value |
| 11 | customPlanResolver returns null | any | default plan |
| 12 | up-to-date status | any | null |
| 13 | assetPattern matching | native/high | Correct asset selected |
| 14 | Platform/arch auto-matching | native/high | Current OS/arch asset |

#### `api/apply.e2e.test.ts` — Update Application (15 cases)

| # | Scenario | Plan type | Expected |
|---|----------|-----------|----------|
| 1 | Full native pipeline | native-in-place | kind: "success" |
| 2 | tar.gz archive | native-in-place | Extract + replace OK |
| 3 | zip archive | native-in-place | Extract + replace OK |
| 4 | Bare binary (no archive) | native-in-place | Direct copy + replace |
| 5 | Checksum passes | native-in-place | Verification OK |
| 6 | Checksum mismatch | native-in-place | CHECKSUM_MISMATCH error |
| 7 | Download fails (404) | native-in-place | DOWNLOAD_FAILED |
| 8 | onProgress callback | native-in-place | All phases in order |
| 9 | AbortSignal cancellation | native-in-place | Aborted + cleanup |
| 10 | print-only mode | delegate-command | Command string returned |
| 11 | execute mode success | delegate-command | kind: "success" |
| 12 | execute mode failure | delegate-command | COMMAND_FAILED |
| 13 | Permission error | delegate-command | PERMISSION_DENIED |
| 14 | Timeout | delegate-command | COMMAND_TIMEOUT |
| 15 | AbortSignal cancellation | delegate-command | COMMAND_ABORTED |

#### `api/pipeline.e2e.test.ts` — Full Pipeline, Factory, Version Management (16 cases)

| # | Scenario | Method | Environment | Expected |
|---|----------|--------|-------------|----------|
| 1 | Update available (pre-seeded cache with newer version) | checkAndNotify | native | Banner string returned |
| 2 | Already latest (pre-seeded cache with same version) | checkAndNotify | any | null |
| 3 | Stale cache, background spawn | checkAndNotify | any | Returns cached result or null (never throws) |
| 4 | Native full flow | autoUpdate | native | success + suggest-restart |
| 5 | npm-global full flow | autoUpdate | npm-global | success + exit-after-apply |
| 6 | brew-cask full flow | autoUpdate | brew-cask | success + exit-after-apply |
| 7 | unmanaged → manual | autoUpdate | unmanaged | needs-restart or manual |
| 8 | Already latest → skip | autoUpdate | any | up-to-date |
| 9 | beforeApply returns false | autoUpdate | any | Aborted |
| 10 | afterApply hook called | autoUpdate | any | Hook execution verified |
| 11 | onError hook called | autoUpdate | any | Error triggers hook |
| 12 | listVersions | listVersions | any | Version list + pagination |
| 13 | switchVersion downgrade | switchVersion | native | Specified version replaced |
| 14 | switchVersion execute=false | switchVersion | npm-global | print-only command |
| 15 | UpdateKit.create() factory | create | npm-global (with package.json) | Auto-resolves appName/currentVersion from package.json |
| 16 | listVersions with pagination cursor | listVersions | any | Second page via cursor returns next batch |

#### `api/hooks.e2e.test.ts` — Hook System (7 cases)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | beforeCheck returns false | Check skipped |
| 2 | beforeCheck returns true | Normal proceed |
| 3 | beforeApply returns false | Apply skipped |
| 4 | beforeApply receives plan | Plan object verified |
| 5 | afterApply receives result | Result object verified |
| 6 | onError receives UpdateKitError | Error code/message verified |
| 7 | Async hooks supported | Promise-returning hooks work |

#### `api/custom.e2e.test.ts` — Custom Channels/Resolvers (5 cases)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | customDetector returns "docker" channel | Detected correctly |
| 2 | Multiple customDetectors, first wins | Priority verified |
| 3 | customPlanResolver returns native-in-place | Custom plan executed |
| 4 | customPlanResolver returns delegate-command | Custom delegate executed |
| 5 | customPlanResolver returns manual-install | Manual message returned |

#### `api/errors.e2e.test.ts` — Error Scenarios (17 cases)

| # | Scenario | Trigger | Expected error code |
|---|----------|---------|---------------------|
| 1 | Fetch timeout | Delayed AbortError | NETWORK_ERROR |
| 2 | DNS failure | TypeError from fetch | NETWORK_ERROR |
| 3 | HTTP 500 | Status 500 response | source "error" kind |
| 4 | HTTP 403 rate limit | Status 403 response | source "error" kind |
| 5 | Download stream interrupted | ReadableStream error mid-transfer | DOWNLOAD_FAILED |
| 6 | Empty response body | content-length=0 | DOWNLOAD_FAILED |
| 7 | File not in SHA256SUMS | Missing filename | CHECKSUM_MISSING |
| 8 | SHA256SUMS fetch fails | checksumUrl returns 404 | CHECKSUM_FETCH_FAILED |
| 9 | Hash mismatch | Wrong artifact content | CHECKSUM_MISMATCH |
| 10 | SHA256SUMS format broken | Unparseable content | CHECKSUM_PARSE_FAILED |
| 11 | Corrupted tar.gz | Invalid binary data | EXTRACT_FAILED |
| 12 | Cache dir not writable | Read-only directory | CACHE_ERROR (silent) |
| 13 | Target path not writable | Read-only directory | APPLY_FAILED |
| 14 | Command not found | Binary missing from PATH | COMMAND_SPAWN_FAILED |
| 15 | npm EACCES | stderr="EACCES", exit=1 | PERMISSION_DENIED |
| 16 | Delegate timeout | MOCK_DELAY_MS=15000 | COMMAND_TIMEOUT |
| 17 | Invalid semver | currentVersion="abc" | Plain Error ("Invalid semver version") — not UpdateKitError |

#### `api/safety.e2e.test.ts` — Safety Policy Verification (6 cases)

| # | Scenario | Expected behavior |
|---|----------|-------------------|
| 1 | HTTP URL rejected | INSECURE_URL error |
| 2 | Only whitelisted commands execute | npm/brew/apt pass, others blocked |
| 3 | Low confidence → print-only forced | Execute mode downgraded |
| 4 | checkAndNotify never throws | null on all errors |
| 5 | autoUpdate never throws | kind="failed" on errors |
| 6 | Atomic replace: original preserved on failure | Original file intact |

### CLI Level

#### `cli/detect.e2e.test.ts` (7 cases)

| # | Scenario | Args | Environment | Expected |
|---|----------|------|-------------|----------|
| 1 | Native detection (text) | `detect` | native | stdout contains channel, confidence |
| 2 | Native detection (json) | `detect --json` | native | Parseable JSON, channel="native" |
| 3 | npm-global detection | `detect --json` | npm-global | channel="npm-global" |
| 4 | brew-cask detection | `detect --json` | brew-cask | channel="brew-cask" |
| 5 | unmanaged detection | `detect --json` | unmanaged | channel="unmanaged" |
| 6 | Custom config path | `detect --config ./custom.json` | native | Custom config used |
| 7 | Config file missing | `detect --config nonexistent.json` | - | Error message + non-zero exit |

#### `cli/check.e2e.test.ts` (6 cases)

| # | Scenario | Args | Expected |
|---|----------|------|----------|
| 1 | Blocking, update available | `check --blocking --json` | kind="available", exit=0 |
| 2 | Blocking, up to date | `check --blocking --json` | kind="up-to-date", exit=0 |
| 3 | Non-blocking, no cache | `check --json` | kind="unknown", exit=0 |
| 4 | Non-blocking, cache hit | `check --json` | Cached result returned |
| 5 | Background trigger | `check --background` | exit=0, cache file created |
| 6 | All sources fail | `check --blocking --json` | kind="unknown" + reason |

#### `cli/plan.e2e.test.ts` (6 cases)

| # | Scenario | Args | Environment | Expected |
|---|----------|------|-------------|----------|
| 1 | Native plan | `plan --json` | native | type="native-in-place" |
| 2 | npm-global plan | `plan --json` | npm-global | type="delegate-command" |
| 3 | brew-cask plan | `plan --json` | brew-cask | type="delegate-command" |
| 4 | Unmanaged, no assets | `plan --json` | unmanaged | type="manual-install" |
| 5 | Up to date | `plan --json` | any | "up-to-date" message |
| 6 | Text output | `plan` | native | Human-readable plan |

#### `cli/apply.e2e.test.ts` (5 cases)

| # | Scenario | Args | Environment | Expected |
|---|----------|------|-------------|----------|
| 1 | Native apply success | `apply --json` | native | Binary replaced + exit=0 |
| 2 | Delegate print-only | `apply --json` | npm-global | Command output + exit=0 |
| 3 | Delegate execute success | `apply --execute --json` | npm-global | Mock npm executed + success |
| 4 | Delegate execute failure | `apply --execute --json` | npm-global (fail) | Error + non-zero exit |
| 5 | Up to date → skip | `apply --json` | any (up-to-date) | "up-to-date" message |

#### `cli/cache.e2e.test.ts` (4 cases)

| # | Scenario | Args | Expected |
|---|----------|------|----------|
| 1 | Show with cache | `cache show --json` | Cache contents displayed |
| 2 | Show without cache | `cache show` | "no cache" message |
| 3 | Clear cache | `cache clear` | Cache file deleted |
| 4 | Clear then show | `cache clear` → `cache show` | "no cache" |

#### `cli/doctor.e2e.test.ts` (4 cases)

| # | Scenario | Args | Expected |
|---|----------|------|----------|
| 1 | Valid config | `doctor` | All checks pass |
| 2 | Missing config fields | `doctor` | Problem field identified |
| 3 | Source connectivity fail | `doctor` | Connectivity check fails |
| 4 | JSON output | `doctor --json` | Structured diagnostic result |

#### `cli/errors.e2e.test.ts` (4 cases)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Unknown subcommand | Usage output + exit=1 |
| 2 | --help flag | Usage output + exit=0 |
| 3 | Invalid config JSON | Parse error message |
| 4 | Missing required config fields | Validation error message |
