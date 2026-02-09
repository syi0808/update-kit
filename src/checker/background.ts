import type { VersionSource } from './sources/index.js';
import type { CacheEntry } from './cache.js';
import { writeCache } from './cache.js';

/** Configuration for background version check. */
export interface BackgroundCheckConfig {
  appName: string;
  currentVersion: string;
  cacheDir: string;
}

/**
 * Spawn a fire-and-forget background version check.
 * Never blocks the caller and never throws.
 *
 * @param config - App name, current version, and cache directory
 * @param sources - Version sources to try in order
 * @param timeoutMs - Abort timeout in milliseconds (default: 10s)
 */
export function spawnBackgroundCheck(
  config: BackgroundCheckConfig,
  sources: VersionSource[],
  timeoutMs: number = 10_000,
): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  backgroundFetch(config, sources, controller.signal)
    .catch(() => {
      // Intentionally swallowed — background failures are silent
    })
    .finally(() => {
      clearTimeout(timer);
    });
}

async function backgroundFetch(
  config: BackgroundCheckConfig,
  sources: VersionSource[],
  signal: AbortSignal,
): Promise<void> {
  const { appName, currentVersion, cacheDir } = config;

  for (const source of sources) {
    if (signal.aborted) return;

    const result = await source.fetchLatest({ signal });

    if (result.kind === 'not-modified') return;
    if (result.kind === 'error') continue;

    const entry: CacheEntry = {
      latestVersion: result.info.version,
      currentVersionAtCheck: currentVersion,
      lastCheckedAt: new Date().toISOString(),
      source: source.name,
      etag: result.etag,
      releaseUrl: result.info.releaseUrl,
      releaseNotes: result.info.releaseNotes,
    };
    await writeCache(cacheDir, appName, entry);
    return;
  }
}
