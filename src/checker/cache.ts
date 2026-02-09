import fs from 'node:fs/promises';
import path from 'node:path';

/** Cached version check result persisted to disk. */
export interface CacheEntry {
  /** Latest version fetched from source */
  latestVersion: string;
  /** Current version at the time of check */
  currentVersionAtCheck: string;
  /** Last check time (ISO 8601) */
  lastCheckedAt: string;
  /** Version source identifier (e.g. "github", "npm") */
  source: string;
  /** HTTP ETag for conditional requests */
  etag?: string;
  /** Release page URL */
  releaseUrl?: string;
  /** Release notes (markdown, etc.) */
  releaseNotes?: string;
}

function getCachePath(cacheDir: string, appName: string): string {
  return path.join(cacheDir, appName, 'update-check.json');
}

/**
 * Read a cached version check entry from disk.
 * Returns `null` if the file does not exist, is corrupted, or has invalid structure.
 */
export async function readCache(
  cacheDir: string,
  appName: string,
): Promise<CacheEntry | null> {
  const filePath = getCachePath(cacheDir, appName);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (
      typeof parsed.latestVersion !== 'string' ||
      typeof parsed.currentVersionAtCheck !== 'string' ||
      typeof parsed.lastCheckedAt !== 'string' ||
      typeof parsed.source !== 'string'
    ) {
      return null;
    }

    return parsed as CacheEntry;
  } catch {
    return null;
  }
}

/**
 * Atomically write a cache entry to disk.
 * Uses a temp file + rename pattern to prevent partial writes.
 */
export async function writeCache(
  cacheDir: string,
  appName: string,
  entry: CacheEntry,
): Promise<void> {
  const filePath = getCachePath(cacheDir, appName);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;

  try {
    const data = JSON.stringify(entry, null, 2) + '\n';
    await fs.writeFile(tmpPath, data, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Intentionally ignored — tmp file may already be gone
    }
    throw error;
  }
}

/**
 * Check whether a cache entry is stale based on the given interval.
 * Returns `true` if the entry has expired or the timestamp is unparseable.
 */
export function isCacheStale(entry: CacheEntry, intervalMs: number): boolean {
  const checkedAt = new Date(entry.lastCheckedAt).getTime();

  if (Number.isNaN(checkedAt)) {
    return true;
  }

  return Date.now() > checkedAt + intervalMs;
}
