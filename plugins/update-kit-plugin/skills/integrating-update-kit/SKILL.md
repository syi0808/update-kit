---
name: integrating-update-kit
description: Integrates update-kit into CLI projects for self-update and version notification. Use when adding update checking, auto-update, version banner, or self-update to a Node.js or Rust CLI application. Triggered by "add update-kit", "integrate self-update", "add version check", or "update notification".
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

Integrate `update-kit` into a CLI project. update-kit detects how a CLI was installed and manages self-updates via a channel-based policy engine (Detection -> Check -> Plan -> Apply). Available for both **TypeScript/Node.js** and **Rust** projects.

## Workflow

### Step 1: Explore the target project

Before generating code, gather context:

**For Node.js / TypeScript projects:**
1. Read `package.json` (`name`, `version`, `type` (module vs commonjs), `bin`, dependencies)
2. Find the CLI entry point (file referenced in `bin` or `main`)
3. Check for TypeScript (`tsconfig.json`, `.ts` files)
4. Determine module system: ESM (`"type": "module"`) or CJS
5. Look for existing update-check mechanisms to avoid conflicts

**For Rust projects:**
1. Read `Cargo.toml` (`name`, `version`, `edition`, existing dependencies)
2. Find the CLI entry point (`src/main.rs` or binary target)
3. Check for existing update/self-update mechanisms to avoid conflicts
4. Verify async runtime: `tokio` with `"full"` features is required

### Step 2: Ask the user

Use `AskUserQuestion` (skip what is already known):

1. **Version source**: Where to check for new versions?
   - GitHub Releases (compiled binaries)
   - npm registry (npm-published packages)
   - JSR (Deno/JSR packages)
   - Homebrew (cask-distributed apps)
   - Custom manifest URL
2. **Update behavior**: What happens when an update is found?
   - **Notify only** (`checkAndNotify` / `check_and_notify`): print banner at startup
   - **Auto-update** (`autoUpdate` / `auto_update`): full detect/download/apply pipeline
   - **Version listing & switching** (`listVersions` + `switchVersion` / `list_versions` + `switch_version`): let users pick a version (supports downgrade)
   - **Manual pipeline**: step-by-step control
3. **Delegate mode** (if auto-update or switchVersion): Execute package-manager commands or print-only?

### Step 3: Install

**For Node.js / TypeScript:**
```bash
pnpm add update-kit    # or npm install / yarn add / bun add
```

**For Rust:**
```bash
cargo add update-kit
cargo add tokio --features full    # if not already present
```

### Step 4: Generate integration code

**For Node.js / TypeScript:**

Read `references/integration-patterns.md` to select the matching pattern. Read `references/api-reference.md` for full API details when needed.

**Quick reference, creating an instance:**

```typescript
const kit = await UpdateKit.create({ sources: [...] });
```

Auto-detects `appName` and `currentVersion` from the caller's nearest `package.json` via call stack inspection. Also auto-fills `repository` from package.json for source inference.

**Quick reference, additional config options:**

| Option | Description |
|--------|-------------|
| `customDetectors` | Custom install channel detectors (checked before built-in ones) |
| `customPlanResolver` | Custom plan resolver (overrides default plan for a channel) |
| `repository` | GitHub repo URL/shorthand for auto-inferring GitHub source |

**Quick reference, version sources:**

| Type | Required Fields |
|------|----------------|
| `github` | `owner`, `repo` |
| `npm` | `packageName` |
| `jsr` | `scope` (no @), `name` |
| `brew` | `caskName` |
| `custom` | `url` |

**Quick reference, main methods:**

| Method | Returns | Throws? |
|--------|---------|---------|
| `checkAndNotify()` | `Promise<string \| null>` | Never |
| `autoUpdate(options?)` | `Promise<ApplyResult>` | Never |
| `detectInstall()` | `Promise<InstallDetection>` | Yes |
| `checkUpdate(mode?)` | `Promise<UpdateStatus>` | Yes |
| `planUpdate(status, detection)` | `UpdatePlan \| null` | No (sync) |
| `applyUpdate(plan, options?)` | `Promise<ApplyResult>` | Yes |
| `listVersions(options?)` | `Promise<VersionListResult>` | No |
| `switchVersion(version, options?)` | `Promise<ApplyResult>` | Never |

---

**For Rust:**

Read `references/integration-patterns-rust.md` to select the matching pattern. Read `references/api-reference-rust.md` for full API details when needed.

**Quick reference, creating an instance:**

```rust
let kit = UpdateKit::new(UpdateKitConfig::Explicit {
    app_name: "my-cli".into(),
    current_version: env!("CARGO_PKG_VERSION").into(),
    base: BaseConfig {
        sources: Some(vec![VersionSourceConfig::Github {
            owner: "myorg".into(), repo: "my-cli".into(),
            token: None, api_base_url: None,
        }]),
        ..Default::default()
    },
})?;
```

Requires explicit `app_name` and `current_version` (no call-stack auto-detection). Use `env!("CARGO_PKG_VERSION")` to read the version from `Cargo.toml` at compile time.

**Quick reference, config variants:**

| Variant | Description |
|---------|-------------|
| `UpdateKitConfig::Explicit` | Requires `app_name` and `current_version` directly |
| `UpdateKitConfig::Pkg` | Reads from a `PackageInfo` struct, with optional overrides |

**Quick reference, version sources:**

| Variant | Required Fields |
|---------|----------------|
| `VersionSourceConfig::Github` | `owner`, `repo` |
| `VersionSourceConfig::Npm` | `package_name` |
| `VersionSourceConfig::Jsr` | `scope`, `name` |
| `VersionSourceConfig::Brew` | `cask_name` |
| `VersionSourceConfig::Custom` | `url` |

**Quick reference, main methods:**

| Method | Returns | Panics? |
|--------|---------|---------|
| `check_and_notify()` | `Result<Option<String>, UpdateKitError>` | Never |
| `auto_update(options)` | `ApplyResult` | Never |
| `detect_install()` | `Result<InstallDetection, UpdateKitError>` | No |
| `check_update(mode)` | `Result<UpdateStatus, UpdateKitError>` | No |
| `plan_update(status, detection)` | `Option<UpdatePlan>` | No (sync) |
| `apply_update(plan, options)` | `ApplyResult` | No |
| `list_versions(options)` | `Result<VersionListResult, UpdateKitError>` | No |
| `switch_version(target, options)` | `ApplyResult` | Never |

### Step 5: Verify

After generating the integration code, run through the relevant checklist:

**For Node.js / TypeScript:**
- [ ] `update-kit` is in `dependencies` (not devDependencies)
- [ ] Module syntax matches the project (ESM `import` vs CJS `require`)
- [ ] Version source matches the project's actual distribution channel
- [ ] Project uses ESM (`"type": "module"`) for `UpdateKit.create()` and Node.js `>=18`
- [ ] `npmPackageName` / `brewCaskName` set if they differ from `appName`
- [ ] Banner output goes to `stderr` (not stdout) to avoid interfering with piped output
- [ ] Run `pnpm build` (or equivalent) to verify no compilation errors
- [ ] If tests exist, run them to confirm no regressions

**For Rust:**
- [ ] `update-kit` is in `[dependencies]` in `Cargo.toml`
- [ ] `tokio` with `features = ["full"]` is in dependencies
- [ ] Version source matches the project's actual distribution channel
- [ ] `app_name` and `current_version` are set correctly (use `env!("CARGO_PKG_VERSION")`)
- [ ] `npm_package_name` / `brew_cask_name` set if applicable
- [ ] Banner output goes to `stderr` (not stdout) to avoid interfering with piped output
- [ ] Run `cargo build` to verify no compilation errors
- [ ] Run `cargo test` to confirm no regressions
