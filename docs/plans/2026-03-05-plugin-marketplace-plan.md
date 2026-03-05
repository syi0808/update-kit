# Plugin & Marketplace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the existing `integrating-update-kit` skill into a Claude Code plugin with doctor command and integration reviewer agent, hosted as a marketplace within this repository.

**Architecture:** Create a `plugins/update-kit-plugin/` directory containing the plugin manifest, migrated skill, a diagnostic command, and a review agent. Add `.claude-plugin/marketplace.json` at the repo root to serve as the marketplace catalog. The existing `.claude/skills/` directory will be removed after migration.

**Tech Stack:** Claude Code plugin system (plugin.json, marketplace.json, SKILL.md, commands/, agents/)

---

### Task 1: Create Plugin Directory Structure

**Files:**
- Create: `plugins/update-kit-plugin/.claude-plugin/plugin.json`

**Step 1: Create the plugin manifest**

Create `plugins/update-kit-plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "update-kit",
  "description": "Integrates update-kit into CLI projects for self-update and version notification. Provides integration skill, diagnostic doctor command, and code review agent.",
  "version": "0.1.1",
  "author": {
    "name": "Yein Sung"
  },
  "homepage": "https://github.com/syi0808/update-kit",
  "repository": "https://github.com/syi0808/update-kit",
  "license": "Apache-2.0",
  "keywords": ["update", "self-update", "cli", "version-check", "auto-update"]
}
```

**Step 2: Verify directory exists**

Run: `ls -la plugins/update-kit-plugin/.claude-plugin/`
Expected: `plugin.json` listed

**Step 3: Commit**

```bash
git add plugins/update-kit-plugin/.claude-plugin/plugin.json
git commit -m "feat: add plugin manifest for update-kit plugin"
```

---

### Task 2: Migrate Skill to Plugin

**Files:**
- Create: `plugins/update-kit-plugin/skills/integrating-update-kit/SKILL.md`
- Create: `plugins/update-kit-plugin/skills/integrating-update-kit/references/api-reference.md`
- Create: `plugins/update-kit-plugin/skills/integrating-update-kit/references/integration-patterns.md`
- Source: `.claude/skills/integrating-update-kit/` (read existing files)

**Step 1: Copy skill files to plugin directory**

Copy the existing skill files into the plugin structure. The content stays identical — no modifications needed to the skill itself since it uses relative references to its own `references/` directory.

- Copy `.claude/skills/integrating-update-kit/SKILL.md` -> `plugins/update-kit-plugin/skills/integrating-update-kit/SKILL.md`
- Copy `.claude/skills/integrating-update-kit/references/api-reference.md` -> `plugins/update-kit-plugin/skills/integrating-update-kit/references/api-reference.md`
- Copy `.claude/skills/integrating-update-kit/references/integration-patterns.md` -> `plugins/update-kit-plugin/skills/integrating-update-kit/references/integration-patterns.md`

**Step 2: Verify the copied files**

Run: `find plugins/update-kit-plugin/skills -type f | sort`
Expected:
```
plugins/update-kit-plugin/skills/integrating-update-kit/SKILL.md
plugins/update-kit-plugin/skills/integrating-update-kit/references/api-reference.md
plugins/update-kit-plugin/skills/integrating-update-kit/references/integration-patterns.md
```

**Step 3: Verify content matches**

Run: `diff .claude/skills/integrating-update-kit/SKILL.md plugins/update-kit-plugin/skills/integrating-update-kit/SKILL.md`
Expected: no output (files are identical)

**Step 4: Commit**

```bash
git add plugins/update-kit-plugin/skills/
git commit -m "feat: migrate integrating-update-kit skill to plugin"
```

---

### Task 3: Create Doctor Command

**Files:**
- Create: `plugins/update-kit-plugin/commands/doctor.md`

**Step 1: Write the doctor command**

Create `plugins/update-kit-plugin/commands/doctor.md`:

```markdown
---
description: Diagnose update-kit integration in the current project. Checks dependencies, module system, version source config, and API usage.
---

# update-kit Doctor

Diagnose the update-kit integration in the current project. Run through each check below and report results.

## Checks

### 1. Dependency Check
- Read `package.json` and verify `update-kit` is listed in `dependencies` (not `devDependencies`)
- If missing entirely, report: "update-kit is not installed. Run `<package-manager> add update-kit`"
- If in devDependencies, report: "update-kit should be in dependencies, not devDependencies"

### 2. Module System Check
- Determine if the project uses ESM (`"type": "module"` in package.json) or CJS
- Search for update-kit imports: `import { UpdateKit } from 'update-kit'` (ESM) or `require('update-kit')` (CJS)
- If import style doesn't match module system, report the mismatch

### 3. Node.js Version Check
- Check `engines.node` in package.json if present
- update-kit requires Node.js >= 18
- If the engines field specifies a version below 18, report the incompatibility

### 4. API Usage Check
- Search for `UpdateKit.create(`, `checkAndNotify(`, `autoUpdate(`, `listVersions(`, `switchVersion(` calls
- If none found, report: "No update-kit API calls found. The library is installed but not used."
- If found, list which methods are being used

### 5. Version Source Check
- Find the `sources` array in UpdateKit.create() config
- Verify each source has required fields:
  - `github`: needs `owner` and `repo`
  - `npm`: needs `packageName`
  - `jsr`: needs `scope` and `name`
  - `brew`: needs `caskName`
  - `custom`: needs `url`
- If sources is omitted, note that auto-inference is being used (requires `repository` in package.json)

### 6. Banner Output Check
- Find where the banner string from `checkAndNotify()` is printed
- If it uses `console.log()` (stdout), warn: "Banner should use `console.error()` (stderr) to avoid interfering with piped output"
- If it uses `console.error()` or `process.stderr.write()`, report as correct

### 7. Build Check
- If a build script exists in package.json, suggest running it to verify no compilation errors
- Do NOT run it automatically; just suggest the command

## Output Format

Present results as a checklist:
- Use checkmarks for passing checks
- Use X marks for failing checks with actionable fix suggestions
- Use warning signs for non-critical issues
```

**Step 2: Verify file exists**

Run: `ls -la plugins/update-kit-plugin/commands/`
Expected: `doctor.md` listed

**Step 3: Commit**

```bash
git add plugins/update-kit-plugin/commands/doctor.md
git commit -m "feat: add doctor diagnostic command to plugin"
```

---

### Task 4: Create Integration Reviewer Agent

**Files:**
- Create: `plugins/update-kit-plugin/agents/integration-reviewer.md`

**Step 1: Write the integration reviewer agent**

Create `plugins/update-kit-plugin/agents/integration-reviewer.md`:

```markdown
---
description: Reviews update-kit integration code for best practices, correctness, and common pitfalls. Use after integrating update-kit or when reviewing PRs that modify update-kit usage.
allowed-tools:
  - Read
  - Glob
  - Grep
---

# update-kit Integration Reviewer

You are an expert reviewer for update-kit integrations. Review the codebase for update-kit usage and provide actionable feedback.

## Review Checklist

### API Usage Best Practices

1. **Instance creation**: Verify `UpdateKit.create()` is used (not `new UpdateKit()`). The static factory is async and handles auto-detection.

2. **Error handling**:
   - `checkAndNotify()` and `autoUpdate()` never throw — no try/catch needed around them
   - `detectInstall()`, `checkUpdate()`, and `applyUpdate()` can throw — verify they have error handling
   - Check that `UpdateKitError` codes are handled when appropriate (not just generic catch)

3. **Result type handling**: Verify discriminated union results are checked via `result.kind`:
   - `UpdateStatus`: `'available'`, `'up-to-date'`, `'unknown'`
   - `ApplyResult`: `'success'`, `'up-to-date'`, `'needs-restart'`, `'failed'`

4. **Module system**: Ensure import style matches the project (`import` for ESM, `require` for CJS)

### Common Pitfalls

1. **stdout vs stderr**: Banner output MUST go to stderr (`console.error()` or `process.stderr.write()`), not stdout. Stdout output breaks piped commands.

2. **Delegate mode**: If using `autoUpdate()` or `switchVersion()` with `delegateMode: 'execute'`, verify this is intentional. Default is `'print-only'` for safety.

3. **Version source mismatch**: Check that the configured version source matches how the app is actually distributed:
   - npm-published app should use `{ type: 'npm' }` source
   - GitHub releases with binaries should use `{ type: 'github' }` source
   - If `sources` is omitted (auto-inference), verify `repository` exists in package.json

4. **Placement in CLI flow**: `checkAndNotify()` should be called early in the CLI entry point, before command routing. `autoUpdate()` should only be called in an explicit update command.

5. **CI environment**: Consider skipping update checks in CI. Use `beforeCheck` hook: `beforeCheck: () => !process.env.CI`

### Security Review

1. **HTTPS only**: update-kit rejects `http://` URLs. Verify no custom sources use HTTP.
2. **Checksum verification**: `skipChecksum: true` should not be used in production.
3. **No sudo**: update-kit never elevates privileges. Verify the integration doesn't add sudo/elevation.

## Output

Provide a summary with:
- List of files reviewed
- Issues found (severity: error/warning/info)
- Specific code locations and fix suggestions
- Overall assessment: PASS / PASS WITH WARNINGS / NEEDS FIXES
```

**Step 2: Verify file exists**

Run: `ls -la plugins/update-kit-plugin/agents/`
Expected: `integration-reviewer.md` listed

**Step 3: Commit**

```bash
git add plugins/update-kit-plugin/agents/integration-reviewer.md
git commit -m "feat: add integration-reviewer agent to plugin"
```

---

### Task 5: Create Marketplace Catalog

**Files:**
- Create: `.claude-plugin/marketplace.json`

**Step 1: Create the marketplace file**

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "update-kit-marketplace",
  "owner": {
    "name": "Yein Sung",
    "email": "syi0808@gmail.com"
  },
  "metadata": {
    "description": "Plugin marketplace for update-kit — a channel-aware self-update toolkit for Node.js CLI applications",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "update-kit",
      "source": "./plugins/update-kit-plugin",
      "description": "Integrates update-kit into CLI projects for self-update and version notification. Provides integration skill, diagnostic doctor command, and integration code review agent.",
      "category": "developer-tools",
      "tags": ["update", "cli", "self-update", "version", "auto-update"]
    }
  ]
}
```

> **Note on `owner.email`**: Verify the author's email from the git log or package.json. If not available, remove the `email` field.

**Step 2: Verify file exists**

Run: `ls -la .claude-plugin/`
Expected: `marketplace.json` listed

**Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat: add marketplace catalog for update-kit plugins"
```

---

### Task 6: Remove Old Standalone Skill

**Files:**
- Delete: `.claude/skills/integrating-update-kit/SKILL.md`
- Delete: `.claude/skills/integrating-update-kit/references/api-reference.md`
- Delete: `.claude/skills/integrating-update-kit/references/integration-patterns.md`
- Delete: `.claude/skills/integrating-update-kit/references/` (directory)
- Delete: `.claude/skills/integrating-update-kit/` (directory)
- Delete: `.claude/skills/` (directory, if empty)

**Step 1: Verify plugin version works first**

Run: `find plugins/update-kit-plugin -type f | sort`
Expected: All 5 plugin files listed (plugin.json, SKILL.md, api-reference.md, integration-patterns.md, doctor.md, integration-reviewer.md)

**Step 2: Remove old skill directory**

Run: `rm -rf .claude/skills/integrating-update-kit`

**Step 3: Remove empty skills directory if applicable**

Run: `rmdir .claude/skills 2>/dev/null; true`

**Step 4: Verify removal**

Run: `ls .claude/skills 2>&1`
Expected: "No such file or directory" or directory doesn't exist

**Step 5: Commit**

```bash
git add -A .claude/skills/
git commit -m "refactor: remove standalone skill (migrated to plugin)"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add plugin/marketplace section to CLAUDE.md**

Add a new section after the existing "### CLI" section:

```markdown
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

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add plugin section to CLAUDE.md"
```

---

### Task 8: Verify End-to-End

**Step 1: Verify complete plugin structure**

Run: `find plugins/update-kit-plugin -type f | sort`
Expected:
```
plugins/update-kit-plugin/.claude-plugin/plugin.json
plugins/update-kit-plugin/agents/integration-reviewer.md
plugins/update-kit-plugin/commands/doctor.md
plugins/update-kit-plugin/skills/integrating-update-kit/SKILL.md
plugins/update-kit-plugin/skills/integrating-update-kit/references/api-reference.md
plugins/update-kit-plugin/skills/integrating-update-kit/references/integration-patterns.md
```

**Step 2: Verify marketplace file**

Run: `cat .claude-plugin/marketplace.json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j.name, j.plugins.length)"`
Expected: `update-kit-marketplace 1`

**Step 3: Verify plugin.json is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/update-kit-plugin/.claude-plugin/plugin.json','utf8')); console.log('valid')"`
Expected: `valid`

**Step 4: Verify old skill is removed**

Run: `ls .claude/skills/integrating-update-kit 2>&1`
Expected: "No such file or directory"

**Step 5: Verify existing tests still pass**

Run: `pnpm test`
Expected: All tests pass (plugin files are non-code, should not affect tests)

**Step 6: Verify build still works**

Run: `pnpm build`
Expected: Build succeeds (plugin files are not part of the TypeScript build)
