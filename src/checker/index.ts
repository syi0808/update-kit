import semver from "semver";
import { DEFAULT_CHECK_INTERVAL_MS } from "../constants.js";
import type { CheckMode, UpdateStatus } from "../types.js";
import { spawnBackgroundCheck } from "./background.js";
import type { CacheEntry } from "./cache.js";
import {
  createCacheEntry,
  isCacheStale,
  readCache,
  writeCache,
} from "./cache.js";
import type { AssetInfo, VersionSource } from "./sources/index.js";

/** Options for the version checker. */
export interface CheckUpdateOptions {
  /** Application name (used for cache file path) */
  appName: string;
  /** Currently installed version (semver string) */
  currentVersion: string;
  /** Version sources to query, tried in order */
  sources: VersionSource[];
  /** Cache directory path */
  cacheDir: string;
  /** Cache validity interval in milliseconds (default: 72_000_000 = 20 hours) */
  checkInterval?: number;
}

const DEFAULT_INTERVAL = DEFAULT_CHECK_INTERVAL_MS;

/**
 * Check for available updates.
 *
 * - **blocking**: Fetches from sources directly, updates cache, and returns the result.
 * - **non-blocking**: Returns cached result immediately. If the cache is stale or missing,
 *   spawns a background check and returns the stale cache (or `unknown`).
 */
export async function checkUpdate(
  config: CheckUpdateOptions,
  mode: CheckMode,
): Promise<UpdateStatus> {
  const interval = config.checkInterval ?? DEFAULT_INTERVAL;

  if (mode === "non-blocking") {
    return checkNonBlocking(config, interval);
  }

  return checkBlocking(config, interval);
}

async function checkBlocking(
  config: CheckUpdateOptions,
  intervalMs: number,
): Promise<UpdateStatus> {
  const { appName, currentVersion, sources, cacheDir } = config;
  const cached = await readCache(cacheDir, appName);
  const etag = cached?.etag;

  for (const source of sources) {
    const result = await source.fetchLatest({ etag });

    switch (result.kind) {
      case "not-modified": {
        if (cached) {
          const updatedEntry: CacheEntry = {
            ...cached,
            lastCheckedAt: new Date().toISOString(),
          };
          try {
            await writeCache(cacheDir, appName, updatedEntry);
          } catch {
            // Cache write failure is non-fatal for blocking checks
          }
          return buildStatus(currentVersion, cached.latestVersion, cached);
        }
        // etag is derived from cached?.etag, so not-modified without cache
        // implies a server bug (304 without If-None-Match). Try next source.
        continue;
      }
      case "found": {
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
        try {
          await writeCache(cacheDir, appName, entry);
        } catch {
          // Cache write failure is non-fatal for blocking checks
        }
        return buildStatus(
          currentVersion,
          result.info.version,
          entry,
          result.info.assets,
        );
      }
      case "error": {
        if (isRateLimitResult(result)) {
          if (cached) {
            return buildStatus(currentVersion, cached.latestVersion, cached);
          }
          continue;
        }
        continue;
      }
    }
  }

  if (cached) {
    return buildStatus(currentVersion, cached.latestVersion, cached);
  }

  return {
    kind: "unknown",
    reason: "All version sources failed and no cache is available",
  };
}

async function checkNonBlocking(
  config: CheckUpdateOptions,
  intervalMs: number,
): Promise<UpdateStatus> {
  const { appName, currentVersion, sources, cacheDir } = config;
  const cached = await readCache(cacheDir, appName);

  if (cached && !isCacheStale(cached, intervalMs)) {
    return buildStatus(currentVersion, cached.latestVersion, cached);
  }

  spawnBackgroundCheck({ appName, currentVersion, cacheDir }, sources);

  if (cached) {
    return buildStatus(currentVersion, cached.latestVersion, cached);
  }

  return {
    kind: "unknown",
    reason: "No cache available; background check started",
  };
}

function buildStatus(
  currentVersion: string,
  latestVersion: string,
  entry?: Partial<CacheEntry>,
  assets?: AssetInfo[],
): UpdateStatus {
  const current = normalizeVersion(currentVersion);
  const latest = normalizeVersion(latestVersion);

  if (!current || !latest) {
    return {
      kind: "unknown",
      reason: `Unable to parse versions: current="${currentVersion}", latest="${latestVersion}"`,
      cachedLatest: latestVersion,
    };
  }

  if (semver.gt(latest, current)) {
    return {
      kind: "available",
      current: currentVersion,
      latest: latestVersion,
      releaseUrl: entry?.releaseUrl,
      releaseNotes: entry?.releaseNotes,
      assets,
    };
  }

  return {
    kind: "up-to-date",
    current: currentVersion,
  };
}

/**
 * Normalize a version string for comparison.
 * Strips pre-release tags and build metadata, keeping only major.minor.patch.
 * Falls back to `semver.coerce` for partial or non-standard version strings.
 */
export function normalizeVersion(version: string): string | null {
  const parsed = semver.valid(version);
  if (parsed) {
    const sv = semver.parse(parsed);
    return sv ? `${sv.major}.${sv.minor}.${sv.patch}` : parsed;
  }

  const coerced = semver.coerce(version);
  return coerced ? coerced.version : null;
}

function isRateLimitResult(result: {
  kind: "error";
  reason: string;
  status?: number;
}): boolean {
  return result.status === 429 || result.status === 403;
}
