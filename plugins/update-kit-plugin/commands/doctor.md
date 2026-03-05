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
