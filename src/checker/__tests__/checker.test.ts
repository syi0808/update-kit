import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheEntry } from "../cache.js";
import type { VersionSource, VersionSourceResult } from "../sources/index.js";

const mockReadCache = vi.fn<() => Promise<CacheEntry | null>>();
const mockWriteCache = vi.fn<() => Promise<void>>();
const mockIsCacheStale = vi.fn<() => boolean>();
const mockSpawnBackgroundCheck = vi.fn();

vi.mock("../cache.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache.js")>();
  return {
    ...actual,
    readCache: (...args: unknown[]) => mockReadCache(...(args as [])),
    writeCache: (...args: unknown[]) => mockWriteCache(...(args as [])),
    isCacheStale: (...args: unknown[]) => mockIsCacheStale(...(args as [])),
  };
});

vi.mock("../background.js", () => ({
  spawnBackgroundCheck: (...args: unknown[]) =>
    mockSpawnBackgroundCheck(...args),
}));

import { checkUpdate } from "../index.js";

function createMockSource(
  name: string,
  result: VersionSourceResult,
): VersionSource {
  return {
    name,
    fetchLatest: vi.fn().mockResolvedValue(result),
  };
}

const CACHE_DIR = "/tmp/test-cache";

const baseCacheEntry: CacheEntry = {
  latestVersion: "1.5.0",
  currentVersionAtCheck: "1.0.0",
  lastCheckedAt: new Date().toISOString(),
  source: "github",
  etag: '"etag-123"',
  releaseUrl: "https://example.com/releases/1.5.0",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockReadCache.mockResolvedValue(null);
  mockWriteCache.mockResolvedValue(undefined);
  mockIsCacheStale.mockReturnValue(true);
});

describe("checkUpdate — blocking mode", () => {
  it("returns available when source reports newer version", async () => {
    const source = createMockSource("github", {
      kind: "found",
      info: { version: "2.0.0", releaseUrl: "https://example.com/v2" },
      etag: '"new-etag"',
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.current).toBe("1.0.0");
      expect(status.latest).toBe("2.0.0");
      expect(status.releaseUrl).toBe("https://example.com/v2");
    }
  });

  it("returns up-to-date when versions match", async () => {
    const source = createMockSource("github", {
      kind: "found",
      info: { version: "1.0.0" },
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("up-to-date");
  });

  it("writes cache entry on successful fetch", async () => {
    const source = createMockSource("npm", {
      kind: "found",
      info: { version: "3.0.0" },
      etag: '"npm-etag"',
    });

    await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(mockWriteCache).toHaveBeenCalledOnce();
    const writtenEntry = mockWriteCache.mock.calls[0]![2] as CacheEntry;
    expect(writtenEntry.latestVersion).toBe("3.0.0");
    expect(writtenEntry.source).toBe("npm");
    expect(writtenEntry.etag).toBe('"npm-etag"');
  });

  it("passes etag from cache to source", async () => {
    mockReadCache.mockResolvedValue(baseCacheEntry);

    const source = createMockSource("github", {
      kind: "found",
      info: { version: "2.0.0" },
    });

    await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(source.fetchLatest).toHaveBeenCalledWith({ etag: '"etag-123"' });
  });

  it("handles not-modified response by updating cache timestamp", async () => {
    mockReadCache.mockResolvedValue(baseCacheEntry);

    const source = createMockSource("github", {
      kind: "not-modified",
      etag: '"etag-123"',
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    expect(mockWriteCache).toHaveBeenCalledOnce();
    const writtenEntry = mockWriteCache.mock.calls[0]![2] as CacheEntry;
    expect(writtenEntry.latestVersion).toBe("1.5.0");
  });

  it("uses cache fallback on rate limit error", async () => {
    mockReadCache.mockResolvedValue(baseCacheEntry);

    const source = createMockSource("github", {
      kind: "error",
      reason: "GitHub API responded with failure: 429 Too Many Requests",
      status: 429,
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("1.5.0");
    }
  });

  it("uses cache fallback on 403 rate limit", async () => {
    mockReadCache.mockResolvedValue(baseCacheEntry);

    const source = createMockSource("github", {
      kind: "error",
      reason: "GitHub API responded with failure: 403 Forbidden",
      status: 403,
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
  });

  it("tries next source on non-rate-limit error", async () => {
    const failSource = createMockSource("github", {
      kind: "error",
      reason: "Network error: ECONNREFUSED",
    });
    const successSource = createMockSource("npm", {
      kind: "found",
      info: { version: "2.0.0" },
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [failSource, successSource],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    expect(failSource.fetchLatest).toHaveBeenCalledOnce();
    expect(successSource.fetchLatest).toHaveBeenCalledOnce();
  });

  it("returns unknown when all sources fail and no cache", async () => {
    const source = createMockSource("github", {
      kind: "error",
      reason: "Network error: ENOTFOUND",
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("unknown");
    if (status.kind === "unknown") {
      expect(status.reason).toContain("All version sources failed");
    }
  });

  it("falls back to cache when all sources fail", async () => {
    mockReadCache.mockResolvedValue(baseCacheEntry);

    const source = createMockSource("github", {
      kind: "error",
      reason: "Network error: ETIMEDOUT",
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("1.5.0");
    }
  });

  it("skips not-modified source without cache and tries next source", async () => {
    // Edge case: server returns 304 but we have no cache (should not happen, but handle gracefully)
    const notModifiedSource = createMockSource("github", {
      kind: "not-modified",
      etag: '"some-etag"',
    });
    const fallbackSource = createMockSource("npm", {
      kind: "found",
      info: { version: "2.0.0" },
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [notModifiedSource, fallbackSource],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("2.0.0");
    }
    expect(fallbackSource.fetchLatest).toHaveBeenCalledOnce();
  });

  it("returns unknown when not-modified is only source and no cache", async () => {
    const source = createMockSource("github", {
      kind: "not-modified",
      etag: '"etag"',
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("unknown");
  });

  it("returns unknown when no sources are provided and no cache", async () => {
    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("unknown");
  });
});

describe("checkUpdate — non-blocking mode", () => {
  it("returns cached result immediately when cache is fresh", async () => {
    mockReadCache.mockResolvedValue(baseCacheEntry);
    mockIsCacheStale.mockReturnValue(false);

    const source = createMockSource("github", {
      kind: "found",
      info: { version: "9.9.9" },
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "non-blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("1.5.0");
    }
    expect(source.fetchLatest).not.toHaveBeenCalled();
    expect(mockSpawnBackgroundCheck).not.toHaveBeenCalled();
  });

  it("returns stale cache and spawns background check when cache is stale", async () => {
    mockReadCache.mockResolvedValue(baseCacheEntry);
    mockIsCacheStale.mockReturnValue(true);

    const source = createMockSource("github", {
      kind: "found",
      info: { version: "9.9.9" },
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "non-blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("1.5.0");
    }
    expect(mockSpawnBackgroundCheck).toHaveBeenCalledOnce();
    expect(source.fetchLatest).not.toHaveBeenCalled();
  });

  it("returns unknown and spawns background check when no cache", async () => {
    mockReadCache.mockResolvedValue(null);

    const source = createMockSource("github", {
      kind: "found",
      info: { version: "2.0.0" },
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source],
        cacheDir: CACHE_DIR,
      },
      "non-blocking",
    );

    expect(status.kind).toBe("unknown");
    expect(mockSpawnBackgroundCheck).toHaveBeenCalledOnce();
  });
});

describe("checkUpdate — multi-source failover", () => {
  it("uses first successful source and does not try subsequent ones", async () => {
    const source1 = createMockSource("github", {
      kind: "found",
      info: { version: "2.0.0" },
    });
    const source2 = createMockSource("npm", {
      kind: "found",
      info: { version: "3.0.0" },
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source1, source2],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("2.0.0");
    }
    expect(source1.fetchLatest).toHaveBeenCalledOnce();
    expect(source2.fetchLatest).not.toHaveBeenCalled();
  });

  it("falls through to second source when first fails", async () => {
    const source1 = createMockSource("github", {
      kind: "error",
      reason: "Network error",
    });
    const source2 = createMockSource("npm", {
      kind: "found",
      info: { version: "2.5.0" },
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source1, source2],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("2.5.0");
    }
  });

  it("falls through all sources and uses cache on all failures", async () => {
    mockReadCache.mockResolvedValue(baseCacheEntry);

    const source1 = createMockSource("github", {
      kind: "error",
      reason: "Network error",
    });
    const source2 = createMockSource("npm", {
      kind: "error",
      reason: "npm registry error: 500",
    });

    const status = await checkUpdate(
      {
        appName: "test",
        currentVersion: "1.0.0",
        sources: [source1, source2],
        cacheDir: CACHE_DIR,
      },
      "blocking",
    );

    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("1.5.0");
    }
  });
});
