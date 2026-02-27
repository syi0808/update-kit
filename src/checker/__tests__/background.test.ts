import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VersionSource, VersionSourceResult } from '../sources/index.js';
import type { CacheEntry } from '../cache.js';

const mockWriteCache = vi.fn<() => Promise<void>>();

vi.mock('../cache.js', () => ({
  writeCache: (...args: unknown[]) => mockWriteCache(...(args as [])),
}));

import { spawnBackgroundCheck, _resetBackgroundState, type BackgroundCheckConfig } from '../background.js';

function createMockSource(
  name: string,
  result: VersionSourceResult,
): VersionSource {
  return {
    name,
    fetchLatest: vi.fn().mockResolvedValue(result),
  };
}

const baseConfig: BackgroundCheckConfig = {
  appName: 'test-app',
  currentVersion: '1.0.0',
  cacheDir: '/tmp/test-cache',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteCache.mockResolvedValue(undefined);
  _resetBackgroundState();
});

describe('spawnBackgroundCheck', () => {
  it('does not block the caller', () => {
    const source = createMockSource('github', {
      kind: 'found',
      info: { version: '2.0.0' },
    });

    // spawnBackgroundCheck returns void synchronously
    const result = spawnBackgroundCheck(baseConfig, [source]);
    expect(result).toBeUndefined();
  });

  it('writes cache on successful fetch', async () => {
    const source = createMockSource('github', {
      kind: 'found',
      info: { version: '2.0.0', releaseUrl: 'https://example.com/v2' },
      etag: '"etag-1"',
    });

    spawnBackgroundCheck(baseConfig, [source]);

    // Wait for the fire-and-forget promise to settle
    await vi.waitFor(() => {
      expect(mockWriteCache).toHaveBeenCalledOnce();
    });

    const writtenEntry = mockWriteCache.mock.calls[0]![2] as CacheEntry;
    expect(writtenEntry.latestVersion).toBe('2.0.0');
    expect(writtenEntry.source).toBe('github');
    expect(writtenEntry.etag).toBe('"etag-1"');
    expect(writtenEntry.releaseUrl).toBe('https://example.com/v2');
  });

  it('does not throw when source fails', async () => {
    const source = createMockSource('github', {
      kind: 'error',
      reason: 'Network error',
    });

    expect(() => spawnBackgroundCheck(baseConfig, [source])).not.toThrow();

    // Let the async work settle
    await new Promise((r) => setTimeout(r, 50));

    expect(mockWriteCache).not.toHaveBeenCalled();
  });

  it('stops on not-modified response', async () => {
    const source = createMockSource('github', {
      kind: 'not-modified',
      etag: '"old-etag"',
    });

    spawnBackgroundCheck(baseConfig, [source]);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockWriteCache).not.toHaveBeenCalled();
  });

  it('uses first successful source and skips the rest', async () => {
    const source1 = createMockSource('github', {
      kind: 'found',
      info: { version: '2.0.0' },
    });
    const source2 = createMockSource('npm', {
      kind: 'found',
      info: { version: '3.0.0' },
    });

    spawnBackgroundCheck(baseConfig, [source1, source2]);

    await vi.waitFor(() => {
      expect(mockWriteCache).toHaveBeenCalledOnce();
    });

    const writtenEntry = mockWriteCache.mock.calls[0]![2] as CacheEntry;
    expect(writtenEntry.latestVersion).toBe('2.0.0');
    expect(writtenEntry.source).toBe('github');
    expect(source2.fetchLatest).not.toHaveBeenCalled();
  });

  it('falls through error sources to find a successful one', async () => {
    const source1 = createMockSource('github', {
      kind: 'error',
      reason: 'rate limit',
    });
    const source2 = createMockSource('npm', {
      kind: 'found',
      info: { version: '2.5.0' },
    });

    spawnBackgroundCheck(baseConfig, [source1, source2]);

    await vi.waitFor(() => {
      expect(mockWriteCache).toHaveBeenCalledOnce();
    });

    const writtenEntry = mockWriteCache.mock.calls[0]![2] as CacheEntry;
    expect(writtenEntry.latestVersion).toBe('2.5.0');
    expect(writtenEntry.source).toBe('npm');
  });

  it('deduplicates concurrent background checks', async () => {
    const source = createMockSource('github', {
      kind: 'found',
      info: { version: '2.0.0' },
    });

    // Call twice rapidly — second call should be ignored
    spawnBackgroundCheck(baseConfig, [source]);
    spawnBackgroundCheck(baseConfig, [source]);

    await vi.waitFor(() => {
      expect(mockWriteCache).toHaveBeenCalledOnce();
    });

    // fetchLatest should have been called only once
    expect(source.fetchLatest).toHaveBeenCalledOnce();
  });

  it('allows a new background check after the first completes', async () => {
    const source1 = createMockSource('github', {
      kind: 'found',
      info: { version: '2.0.0' },
    });

    spawnBackgroundCheck(baseConfig, [source1]);

    await vi.waitFor(() => {
      expect(mockWriteCache).toHaveBeenCalledOnce();
    });

    // After completion, a new check should be allowed
    const source2 = createMockSource('npm', {
      kind: 'found',
      info: { version: '3.0.0' },
    });

    spawnBackgroundCheck(baseConfig, [source2]);

    await vi.waitFor(() => {
      expect(mockWriteCache).toHaveBeenCalledTimes(2);
    });
  });

  it('does not throw when writeCache fails', async () => {
    mockWriteCache.mockRejectedValue(new Error('disk full'));

    const source = createMockSource('github', {
      kind: 'found',
      info: { version: '2.0.0' },
    });

    expect(() => spawnBackgroundCheck(baseConfig, [source])).not.toThrow();

    // Let the async work settle — should not cause unhandled rejection
    await new Promise((r) => setTimeout(r, 50));
  });
});
