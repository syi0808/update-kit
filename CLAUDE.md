# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Manager

Use **pnpm** exclusively. Do not use npm or yarn.

## Commands

| Command | Description |
|---|---|
| `pnpm build` | Build with tsup (ESM + CJS dual output) |
| `pnpm test` | Run all tests with vitest |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test -- src/checker` | Run tests in a specific directory |
| `pnpm test -- src/checker/__tests__/cache.test.ts` | Run a single test file |
| `pnpm lint` | Type-check with `tsc --noEmit` |

## Code Style

- All code, comments, and documentation must be written in **English**.
- Task specs in `docs/tasks/` are written in Korean — that is intentional. Generated source code must still be English.
- Internal imports use `.js` extensions (TypeScript ESM convention).
- Discriminated unions are used throughout for result types (`kind` field on `UpdateStatus`, `ApplyResult`; `type` field on `PlanKind`).

## Architecture

**update-kit** is a library + CLI for detecting how a CLI app was installed and managing self-updates. The core concept is a **channel-based policy engine**: the update strategy is determined by how the app was installed.

### Pipeline

```
Detection → Check → Plan → Apply
```

1. **Detection** (`src/detection/`) — Determines install channel (`native`, `npm-global`, `brew-cask`, `unmanaged`) via receipt files, brew/npm queries, and path heuristics. Returns a confidence level.
2. **Checker** (`src/checker/`) — Fetches latest version from pluggable sources (`src/checker/sources/`: GitHub, npm, JSR, Brew, custom manifest). When `sources` is omitted, they are auto-inferred from config and `package.json` fields (`src/checker/infer-sources.ts`), with check order determined by the detected install channel. Supports two modes: `blocking` (fetch now) and `non-blocking` (read cache + spawn background check for next run). Cache is disk-based (`src/checker/cache.ts`).
3. **Planner** (`src/planner/`) — Given an `UpdateStatus` + `InstallDetection`, produces an `UpdatePlan` with one of three strategies: `native-in-place` (download & replace binary), `delegate-command` (run npm/brew), or `manual-install` (print instructions).
4. **Applier** (`src/applier/`) — Executes the plan. `native.ts` handles download/verify/extract/replace. `delegate.ts` runs package manager commands. `verify.ts` does SHA-256 checksum verification.

### Supporting Modules

- **UX** (`src/ux/`) — Banner rendering, progress display, ANSI colors, hook execution.
- **Platform** (`src/platform/`) — OS-specific cache paths and atomic file replacement (rename on Unix, backup+rollback on Windows).
- **Utils** (`src/utils/`) — HTTP fetch with timeout/proxy, filesystem helpers, security validation.
- **Errors** (`src/errors.ts`) — `UpdateKitError` class with structured error codes (e.g., `CHECKSUM_MISMATCH`, `INSECURE_URL`).

### Public API

The `UpdateKit` class (`src/index.ts`) orchestrates the full pipeline. `sources` is optional — when omitted, sources are auto-inferred from config fields (`appName`, `repository`, `brewCaskName`) and ordered by detected channel. Two convenience methods:
- `checkAndNotify()` — One-liner for app startup; returns a banner string or null.
- `autoUpdate()` — Full pipeline: detect → check → plan → apply.

### CLI

`src/cli.ts` provides subcommands: `detect`, `check`, `plan`, `apply`, `cache show/clear`, `doctor`. Supports `--json` output. The `doctor` command (`src/doctor.ts`) validates config, package.json, source resolution, detection, and source connectivity.

### Plugin

The project includes a Claude Code plugin at `plugins/update-kit-plugin/` and a marketplace catalog at `.claude-plugin/marketplace.json`. The plugin provides:
- **Skill** (`/update-kit:integrating-update-kit`) — 5-step integration workflow with API reference and pattern docs
- **Command** (`/update-kit:doctor`) — Diagnostic checks for existing integrations
- **Agent** (`integration-reviewer`) — Code review agent for update-kit usage

Users can install via:
```shell
/plugin marketplace add syi0808/update-kit
/plugin install update-kit@update-kit-marketplace
```

## Testing

- Tests use **vitest** with globals enabled.
- Tests are co-located in `__tests__/` subdirectories next to their source modules.
- Top-level integration tests are in `src/__tests__/`.
- Heavy use of `vi.mock()` for isolating modules; external I/O (network, filesystem, child_process) is always mocked.

## Safety Policies

These are design constraints of the library, not coding guidelines:
- HTTPS-only: rejects `http://` URLs.
- Checksum verification required by default.
- Atomic file replacement to prevent corruption.
- Never elevates privileges (no sudo).
- `delegate-command` defaults to `print-only` mode (shows command without executing).
- Low-confidence detections result in print-only behavior.
