# update-kit

[![npm version](https://img.shields.io/npm/v/update-kit)](https://www.npmjs.com/package/update-kit)
[![CI](https://github.com/syi0808/update-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/syi0808/update-kit/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Self-updates that respect how your CLI was installed.**

Users install CLI tools through npm, Homebrew, direct download, or custom installers — each with its own update semantics. update-kit detects the install channel and picks the right update strategy automatically, so your app stays current without breaking package manager ownership.

## Features

- **Channel Detection** — Identifies install method (npm, Homebrew, native binary, custom) via receipt files, path heuristics, and package manager queries
- **Zero-config Sources** — Infers version sources from `package.json` and prioritizes them by detected channel. No manual setup needed.
- **Pluggable Sources** — GitHub Releases, npm, JSR, Homebrew API, or custom JSON manifest
- **Non-blocking Checks** — Returns cached results instantly; refreshes in the background so startup stays fast
- **Smart Planning** — Picks the safest strategy per channel: binary replacement, delegated package manager command, or manual instructions
- **Safe by Default** — SHA-256 verification, atomic file replacement, HTTPS-only, automatic rollback
- **Version Listing & Switching** — Paginated version list with cursor-based pagination. Upgrade or downgrade to any version.
- **Lifecycle Hooks** — `beforeCheck`, `beforeApply`, `afterApply`, `onError` for telemetry, logging, or custom logic
- **CLI Included** — `detect`, `check`, `plan`, `apply`, `cache`, `doctor` subcommands with JSON output

## Install

```bash
npm install update-kit
# or
pnpm add update-kit
```

> Requires Node.js 24+

## Quick Start

```typescript
import { UpdateKit } from 'update-kit';

const kit = await UpdateKit.create();

// One-liner: show a banner if an update is available
const banner = await kit.checkAndNotify();
if (banner) console.error(banner);
```

Source check order adapts to the install channel — npm-installed apps check npm first, Homebrew apps check brew first. Pass explicit `sources` when you need full control.

### Auto-update

Run the full pipeline — detect, check, plan, apply — in one call:

```typescript
const result = await kit.autoUpdate({
  onProgress: (p) => console.log(p.phase),
});

if (result.kind === 'success') {
  console.log(`Updated from ${result.fromVersion} to ${result.toVersion}`);
}
```

### Step-by-step

Use individual methods when you need finer control:

```typescript
const detection = await kit.detectInstall();
const status = await kit.checkUpdate('blocking');

if (status.kind === 'available') {
  const plan = kit.planUpdate(status, detection);
  if (plan) {
    const result = await kit.applyUpdate(plan);
  }
}
```

### Version listing and switching

```typescript
// List versions with pagination
const versions = await kit.listVersions({ limit: 10 });
if (versions.kind === 'success') {
  for (const v of versions.versions) {
    console.log(`${v.version} — ${v.publishedAt ?? ''}`);
  }
}

// Switch to a specific version (upgrade or downgrade)
const result = await kit.switchVersion('1.2.0', { execute: true });
```

### CLI

```bash
npx update-kit detect            # Show install channel
npx update-kit check             # Check for updates (cached)
npx update-kit check --blocking  # Check directly, skip cache
npx update-kit plan              # Show the update plan
npx update-kit apply             # Apply the update
npx update-kit cache show        # Show cached version data
npx update-kit cache clear       # Clear cache
npx update-kit doctor            # Validate config and connectivity
npx update-kit detect --json     # All commands support --json
```

## How It Works

```
Detection → Check → Plan → Apply
```

1. **Detect** — Determine how the app was installed (npm, Homebrew, native binary, etc.)
2. **Check** — Query the appropriate version source for the latest release
3. **Plan** — Choose the right update strategy based on the install channel
4. **Apply** — Execute the plan: download and replace, delegate to a package manager, or show manual instructions

## Documentation

- [API Reference](docs/API.md) — Configuration, types, version sources, hooks, standalone functions
- [Contributing Guide](CONTRIBUTING.md) — Development setup, code style, testing

## License

Apache License 2.0 — see [LICENSE](LICENSE).

## Author

**Yein Sung**
