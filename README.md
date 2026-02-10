# update-kit

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A channel-aware self-update library and CLI for Node.js CLI applications.

Most CLI tools are installed through different channels — npm, Homebrew, direct download, or custom installers — and each channel has its own update semantics. update-kit detects the install channel automatically and selects the right update strategy, so your app updates itself safely without breaking package manager ownership.

## Features

- **Install Channel Detection** — Identifies how your CLI was installed (npm, Homebrew, native binary, or custom) using receipt files, path heuristics, and package manager queries
- **Pluggable Version Sources** — Checks for updates from GitHub Releases, npm registry, JSR, Homebrew API, or a custom JSON manifest
- **Non-blocking Checks** — Returns cached results instantly and refreshes in the background, so app startup is never delayed
- **Smart Update Planning** — Chooses the safest strategy per channel: in-place binary replacement, delegated package manager command, or manual instructions
- **Safe Application** — SHA-256 checksum verification, atomic file replacement, HTTPS-only enforcement, and automatic rollback on failure
- **Lifecycle Hooks** — `beforeCheck`, `beforeApply`, `afterApply`, and `onError` hooks for telemetry, logging, or custom logic
- **CLI Included** — Built-in `update-kit` CLI with `detect`, `check`, `plan`, `apply`, and `cache` subcommands

## Getting Started

### Requirements

- Node.js 18 or later

### Install

```bash
npm install update-kit
```

Or with other package managers:

```bash
pnpm add update-kit
yarn add update-kit
```

## Usage

```typescript
import { UpdateKit } from 'update-kit';

const kit = await UpdateKit.create({
  sources: [{ type: 'github', owner: 'my-org', repo: 'my-cli' }],
});

const banner = await kit.checkAndNotify();
if (banner) console.error(banner);
```

### Full auto-update

Run the complete pipeline — detect channel, check version, plan strategy, and apply:

```typescript
const result = await kit.autoUpdate({
  onProgress: (p) => console.log(p.phase),
});

if (result.kind === 'success') {
  console.log(`Updated from ${result.fromVersion} to ${result.toVersion}`);
}
```

### Step-by-step control

Use individual methods when you need more control over the pipeline:

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

### CLI

The package includes a CLI for debugging and integration:

```bash
npx update-kit detect          # Show install channel and confidence
npx update-kit check           # Check for updates
npx update-kit check --blocking # Fetch directly instead of using cache
npx update-kit plan            # Show the update plan
npx update-kit apply           # Run the full update pipeline
npx update-kit cache show      # Display cached version data
npx update-kit cache clear     # Clear the cache

# All commands support JSON output
npx update-kit detect --json
```

See the full [API documentation](docs/API.md) for configuration options, version sources, lifecycle hooks, and standalone function exports.

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

## Author

**Sung YeIn**
