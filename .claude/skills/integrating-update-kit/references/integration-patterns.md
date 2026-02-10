# update-kit Integration Patterns

## Table of Contents

- [Pattern A: Startup Notification](#pattern-a-startup-notification)
- [Pattern B: Dedicated Update Command](#pattern-b-dedicated-update-command)
- [Pattern C: Manual Pipeline](#pattern-c-manual-pipeline)
- [Pattern D: With Hooks](#pattern-d-with-hooks)

---

## Pattern A: Startup Notification

**Best for**: Any CLI app. Zero latency impact. Shows a banner if an update is available.
**Method**: `checkAndNotify()` (non-blocking, cache-based)

```typescript
#!/usr/bin/env node
import { UpdateKit } from 'update-kit';

const kit = await UpdateKit.create({
  sources: [{ type: 'github', owner: 'myorg', repo: 'my-cli' }],
});

// Non-blocking: reads cache, spawns background refresh if stale
const banner = await kit.checkAndNotify();
if (banner) console.error(banner);  // stderr to avoid interfering with piped output

// ... rest of CLI logic
```

---

## Pattern B: Dedicated Update Command

**Best for**: CLIs with an explicit `my-cli update` subcommand.
**Method**: `autoUpdate()` with `delegateMode: 'execute'`

```typescript
async function handleUpdateCommand() {
  const kit = await UpdateKit.create({
    sources: [{ type: 'npm', packageName: 'my-cli' }],
    delegateMode: 'execute',  // Actually run npm install -g / brew upgrade
  });

  const result = await kit.autoUpdate({
    onProgress: (p) => {
      if (p.phase === 'downloading' && p.totalBytes) {
        const pct = Math.round((p.bytesDownloaded / p.totalBytes) * 100);
        process.stderr.write(`\rDownloading... ${pct}%`);
      } else {
        console.error(`${p.phase}...`);
      }
    },
  });

  switch (result.kind) {
    case 'success':
      console.log(`Updated from ${result.fromVersion} to ${result.toVersion}`);
      break;
    case 'needs-restart':
      console.log(result.message);
      break;
    case 'failed':
      console.error(`Update failed: ${result.error.message}`);
      process.exitCode = 1;
      break;
  }
}
```

---

## Pattern C: Manual Pipeline

**Best for**: Apps needing custom logic between pipeline stages.
**Methods**: `detectInstall()` -> `checkUpdate()` -> `planUpdate()` -> `applyUpdate()`

```typescript
const kit = await UpdateKit.create({
  sources: [{ type: 'github', owner: 'myorg', repo: 'my-cli' }],
  assetPattern: '{app}-{version}-{target}.tar.gz',
});

const detection = await kit.detectInstall();
console.log(`Installed via: ${detection.channel} (${detection.confidence})`);

const status = await kit.checkUpdate('blocking');
if (status.kind !== 'available') {
  console.log('Already up to date.');
  return;
}

console.log(`Update available: ${status.current} -> ${status.latest}`);

const plan = kit.planUpdate(status, detection);
if (!plan) {
  console.log('No applicable update plan.');
  return;
}

console.log(`Strategy: ${plan.kind.type}`);

const result = await kit.applyUpdate(plan);
if (result.kind === 'success') {
  console.log(`Updated to ${result.toVersion}`);
}
```

---

## Pattern D: With Hooks

**Best for**: Apps needing telemetry, CI gating, or fine-grained control.

```typescript
const kit = await UpdateKit.create({
  sources: [{ type: 'github', owner: 'myorg', repo: 'my-cli' }],
  hooks: {
    beforeCheck: () => {
      // Skip update checks in CI environments
      return !process.env.CI;
    },
    beforeApply: (plan) => {
      // Only allow same-major updates automatically
      const [major] = plan.toVersion.split('.');
      const [currentMajor] = plan.fromVersion.split('.');
      return major === currentMajor;
    },
    afterApply: (result) => {
      analytics.track('update_applied', { kind: result.kind });
    },
    onError: (error) => {
      logger.warn(`Update error [${error.code}]: ${error.message}`);
    },
  },
});
```

---

## Combining Patterns

Patterns compose naturally. Common combinations:

**Startup notification + update command** (Pattern A + B):
- Add `checkAndNotify()` to the main entry point for passive notification
- Add a dedicated `update` subcommand with `autoUpdate()` for active updates

**Any pattern + hooks** (Pattern A/B/C + D):
- Add hooks for CI skipping or telemetry to any pattern
