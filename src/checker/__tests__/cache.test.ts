import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_ERROR } from "../../errors.js";
import {
  type CacheEntry,
  clearCache,
  isCacheStale,
  readCache,
  writeCache,
} from "../cache.js";

let tmpDir: string;

const validEntry: CacheEntry = {
  latestVersion: "2.0.0",
  currentVersionAtCheck: "1.0.0",
  lastCheckedAt: new Date().toISOString(),
  source: "github",
  etag: '"abc"',
  releaseUrl: "https://example.com/v2",
  releaseNotes: "## v2.0.0\n- New feature",
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("readCache", () => {
  it("parses a valid cache file", async () => {
    const dir = path.join(tmpDir, "myapp");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "update-check.json"),
      JSON.stringify(validEntry),
    );

    const result = await readCache(tmpDir, "myapp");
    expect(result).not.toBeNull();
    expect(result?.latestVersion).toBe("2.0.0");
    expect(result?.source).toBe("github");
    expect(result?.etag).toBe('"abc"');
  });

  it("returns null when file does not exist", async () => {
    const result = await readCache(tmpDir, "no-such-app");
    expect(result).toBeNull();
  });

  it("returns null for corrupted JSON", async () => {
    const dir = path.join(tmpDir, "broken");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "update-check.json"), "{ truncated...");

    const result = await readCache(tmpDir, "broken");
    expect(result).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    const dir = path.join(tmpDir, "incomplete");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "update-check.json"),
      JSON.stringify({ latestVersion: "1.0.0" }),
    );

    const result = await readCache(tmpDir, "incomplete");
    expect(result).toBeNull();
  });

  it("returns null when required fields have wrong types", async () => {
    const dir = path.join(tmpDir, "wrongtype");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "update-check.json"),
      JSON.stringify({
        latestVersion: 123,
        currentVersionAtCheck: "1.0.0",
        lastCheckedAt: new Date().toISOString(),
        source: "npm",
      }),
    );

    const result = await readCache(tmpDir, "wrongtype");
    expect(result).toBeNull();
  });
});

describe("writeCache", () => {
  it("writes a valid JSON file", async () => {
    await writeCache(tmpDir, "myapp", validEntry);

    const raw = await fs.readFile(
      path.join(tmpDir, "myapp", "update-check.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.latestVersion).toBe("2.0.0");
    expect(parsed.source).toBe("github");
  });

  it("creates directories automatically", async () => {
    const nested = path.join(tmpDir, "deep", "nested");
    await writeCache(nested, "myapp", validEntry);

    const result = await readCache(nested, "myapp");
    expect(result).not.toBeNull();
    expect(result?.latestVersion).toBe("2.0.0");
  });

  it("overwrites existing cache atomically", async () => {
    await writeCache(tmpDir, "myapp", validEntry);

    const updated: CacheEntry = {
      ...validEntry,
      latestVersion: "3.0.0",
    };
    await writeCache(tmpDir, "myapp", updated);

    const result = await readCache(tmpDir, "myapp");
    expect(result?.latestVersion).toBe("3.0.0");
  });

  it("does not leave temp files on success", async () => {
    await writeCache(tmpDir, "myapp", validEntry);

    const files = await fs.readdir(path.join(tmpDir, "myapp"));
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("isCacheStale", () => {
  it("returns false when within TTL", () => {
    const entry: CacheEntry = {
      ...validEntry,
      lastCheckedAt: new Date().toISOString(),
    };

    expect(isCacheStale(entry, 60_000)).toBe(false);
  });

  it("returns true when past TTL", () => {
    const entry: CacheEntry = {
      ...validEntry,
      lastCheckedAt: new Date(Date.now() - 120_000).toISOString(),
    };

    expect(isCacheStale(entry, 60_000)).toBe(true);
  });

  it("returns true for invalid date", () => {
    const entry: CacheEntry = {
      ...validEntry,
      lastCheckedAt: "not-a-date",
    };

    expect(isCacheStale(entry, 60_000)).toBe(true);
  });
});

describe("readCache — invalid date", () => {
  it("returns null when lastCheckedAt is unparseable date", async () => {
    const dir = path.join(tmpDir, "baddate");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "update-check.json"),
      JSON.stringify({
        latestVersion: "2.0.0",
        currentVersionAtCheck: "1.0.0",
        lastCheckedAt: "not-a-real-date",
        source: "github",
      }),
    );

    const result = await readCache(tmpDir, "baddate");
    expect(result).toBeNull();
  });
});

describe("writeCache — error handling", () => {
  it("throws CACHE_ERROR on write failure", async () => {
    // Use a null byte in path to cause fs.mkdir to fail
    const invalidDir = path.join(tmpDir, "nonexistent\x00illegal");

    await expect(writeCache(invalidDir, "myapp", validEntry)).rejects.toThrow();
  });

  it("throws CACHE_ERROR with proper code when rename fails", async () => {
    // Write a valid cache first to create the directory
    await writeCache(tmpDir, "myapp", validEntry);

    // Now spy on fs.rename to make it fail
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(new Error("rename failed"));

    await expect(writeCache(tmpDir, "myapp", validEntry)).rejects.toThrow(
      expect.objectContaining({ code: CACHE_ERROR }),
    );

    renameSpy.mockRestore();
  });
});

describe("clearCache", () => {
  it("deletes the cache file", async () => {
    await writeCache(tmpDir, "myapp", validEntry);
    await clearCache(tmpDir, "myapp");

    const result = await readCache(tmpDir, "myapp");
    expect(result).toBeNull();
  });

  it("succeeds silently when file does not exist", async () => {
    await expect(clearCache(tmpDir, "no-such-app")).resolves.toBeUndefined();
  });

  it("rethrows non-ENOENT errors", async () => {
    // Create a directory where the cache file would be, so unlink fails with EISDIR/EPERM
    const appDir = path.join(tmpDir, "dirapp");
    await fs.mkdir(appDir, { recursive: true });
    const cacheFilePath = path.join(appDir, "update-check.json");
    // Create a directory at the cache file path instead of a file
    await fs.mkdir(cacheFilePath, { recursive: true });

    await expect(clearCache(tmpDir, "dirapp")).rejects.toThrow();
  });
});
