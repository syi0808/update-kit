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

> See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation including diagrams, integration patterns, design decisions, and module organization.
>
> ARCHITECTURE.md is large (~1,700 lines). Do NOT read the entire file. Instead, use a **subagent(haiku)** to read and summarize only the relevant section. Example:
> ```
> Agent(model: "haiku", prompt: "Read ARCHITECTURE.md and summarize the Planner section. Focus on ...")
> ```

**update-kit** is a library + CLI for detecting how a CLI app was installed and managing self-updates. The core concept is a **channel-based policy engine**: the update strategy is determined by how the app was installed.

**Pipeline**: `Detection → Check → Plan → Apply`

| Stage | Location | Summary |
|-------|----------|---------|
| Detection | `src/detection/` | Determines install channel (`native`, `npm-global`, `brew-cask`, `unmanaged`) with confidence level |
| Checker | `src/checker/` | Fetches latest version from pluggable sources; blocking/non-blocking modes with disk cache |
| Planner | `src/planner/` | Pure function producing `native-in-place`, `delegate-command`, or `manual-install` plan |
| Applier | `src/applier/` | Executes plan: download/verify/extract/replace or package manager delegation |

**Supporting**: UX (`src/ux/`), Platform (`src/platform/`), Utils (`src/utils/`), Errors (`src/errors.ts`), Doctor (`src/doctor.ts`), CLI (`src/cli.ts`)

**Public API**: `UpdateKit` class with `checkAndNotify()` (startup banner) and `autoUpdate()` (full pipeline). Sources auto-inferred when omitted.

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

## Changesets Workflow

This project uses pubm changesets to track changes and automate versioning.

### Rules
- Every PR that changes runtime code must include a changeset file
- Add a changeset: `pubm changesets add`
- Changeset identifiers use package path (e.g., `packages/core`), not registry name. Package names are also accepted and auto-resolved to paths.
- Changeset summaries should be written from the user's perspective
- PRs with `no-changeset` label skip the changeset check (use for docs, CI config, etc.)

### Workflow
1. Make changes on a feature branch
2. Run `pubm changesets add` to select packages, bump type, and summary
3. Commit the generated `.pubm/changesets/<id>.md` file with your PR
4. On merge, changesets accumulate on main
5. When releasing, `pubm` consumes pending changesets to determine versions and generate CHANGELOG

### Bump Type Guide
- **patch**: Bug fixes, internal refactors with no API changes
- **minor**: New features, backward-compatible additions
- **major**: Breaking changes, removed/renamed public APIs

### Review Checklist
- [ ] Changeset file included (or `no-changeset` label applied)
- [ ] Bump type matches the scope of changes
- [ ] Summary is clear and user-facing
