---
name: integrating-update-kit
description: Integrates update-kit into CLI projects for self-update and version notification. Use when adding update checking, auto-update, version banner, or self-update to a Node.js CLI application. Triggered by "add update-kit", "integrate self-update", "add version check", or "update notification".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Integrating update-kit

Integrate `update-kit` into a CLI project. update-kit detects how a CLI was installed and manages self-updates via a channel-based policy engine (Detection -> Check -> Plan -> Apply).

## Workflow

### Step 1: Explore the target project

Before generating code, gather context:

1. Read `package.json` — `name`, `version`, `type` (module vs commonjs), `bin`, dependencies
2. Find the CLI entry point (file referenced in `bin` or `main`)
3. Check for TypeScript (`tsconfig.json`, `.ts` files)
4. Determine module system: ESM (`"type": "module"`) or CJS
5. Look for existing update-check mechanisms to avoid conflicts

### Step 2: Ask the user

Use `AskUserQuestion` (skip what is already known):

1. **Version source** — Where to check for new versions?
   - GitHub Releases (compiled binaries)
   - npm registry (npm-published packages)
   - JSR (Deno/JSR packages)
   - Homebrew (cask-distributed apps)
   - Custom manifest URL
2. **Update behavior** — What happens when an update is found?
   - **Notify only** (`checkAndNotify`) — print banner at startup
   - **Auto-update** (`autoUpdate`) — full detect/download/apply pipeline
   - **Manual pipeline** — step-by-step control
3. **Delegate mode** (if auto-update): Execute package-manager commands or print-only?

### Step 3: Install

Use the project's package manager:
```bash
pnpm add update-kit    # or npm install / yarn add / bun add
```

### Step 4: Generate integration code

Read `references/integration-patterns.md` to select the matching pattern. Read `references/api-reference.md` for full API details when needed.

**Quick reference — Creating an instance:**

```typescript
const kit = await UpdateKit.create({ sources: [...] });
```

Auto-detects `appName` and `currentVersion` from the caller's nearest `package.json` via call stack inspection.

**Quick reference — Version sources:**

| Type | Required Fields |
|------|----------------|
| `github` | `owner`, `repo` |
| `npm` | `packageName` |
| `jsr` | `scope` (no @), `name` |
| `brew` | `caskName` |
| `custom` | `url` |

**Quick reference — Main methods:**

| Method | Returns | Throws? |
|--------|---------|---------|
| `checkAndNotify()` | `Promise<string \| null>` | Never |
| `autoUpdate(options?)` | `Promise<ApplyResult>` | Never |
| `detectInstall()` | `Promise<InstallDetection>` | Yes |
| `checkUpdate(mode?)` | `Promise<UpdateStatus>` | Yes |
| `planUpdate(status, detection)` | `UpdatePlan \| null` | No (sync) |
| `applyUpdate(plan, options?)` | `Promise<ApplyResult>` | Yes |

### Step 5: Verify

After generating the integration code, run through this checklist:

- [ ] `update-kit` is in `dependencies` (not devDependencies)
- [ ] Module syntax matches the project (ESM `import` vs CJS `require`)
- [ ] Version source matches the project's actual distribution channel
- [ ] Project uses ESM (`"type": "module"`) for `UpdateKit.create()`
- [ ] `npmPackageName` / `brewCaskName` set if they differ from `appName`
- [ ] Banner output goes to `stderr` (not stdout) to avoid interfering with piped output
- [ ] Run `pnpm build` (or equivalent) to verify no compilation errors
- [ ] If tests exist, run them to confirm no regressions
