import { DEFAULT_BACKGROUND_TIMEOUT_MS } from "../constants.js";
import { createCacheEntry, writeCache } from "./cache.js";
import type { VersionSource } from "./sources/index.js";

/** Configuration for background version check. */
export interface BackgroundCheckConfig {
  appName: string;
  currentVersion: string;
  cacheDir: string;
}

let backgroundCheckInProgress = false;

/** @internal Reset background check state. For testing only. */
export function _resetBackgroundState(): void {
  backgroundCheckInProgress = false;
}

/** Optional callbacks for background check lifecycle. */
export interface BackgroundCheckCallbacks {
  onError?: (error: unknown) => void;
}

/**
 * Spawn a fire-and-forget background version check.
 * Never blocks the caller and never throws.
 * Deduplicates: if a background check is already running, the call is ignored.
 *
 * @param config - App name, current version, and cache directory
 * @param sources - Version sources to try in order
 * @param timeoutMs - Abort timeout in milliseconds (default: 10s)
 * @param callbacks - Optional callbacks for error observability
 */
export function spawnBackgroundCheck(
  config: BackgroundCheckConfig,
  sources: VersionSource[],
  timeoutMs: number = DEFAULT_BACKGROUND_TIMEOUT_MS,
  callbacks?: BackgroundCheckCallbacks,
): void {
  if (backgroundCheckInProgress) return;
  backgroundCheckInProgress = true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  backgroundFetch(config, sources, controller.signal)
    .catch((error: unknown) => {
      callbacks?.onError?.(error);
      if (process.env.UPDATE_KIT_DEBUG) {
        console.error("[update-kit] Background check failed:", error);
      }
    })
    .finally(() => {
      clearTimeout(timer);
      backgroundCheckInProgress = false;
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

    if (result.kind === "not-modified") return;
    if (result.kind === "error") continue;

    const entry = createCacheEntry(
      result.info.version,
      currentVersion,
      source.name,
      {
        etag: result.etag,
        releaseUrl: result.info.releaseUrl,
        releaseNotes: result.info.releaseNotes,
      },
    );
    await writeCache(cacheDir, appName, entry);
    return;
  }
}
