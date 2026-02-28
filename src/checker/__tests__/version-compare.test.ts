import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeVersion, checkUpdate } from '../index.js';
import type { VersionSource, VersionSourceResult } from '../sources/index.js';

vi.mock('../cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cache.js')>();
  return {
    ...actual,
    readCache: vi.fn().mockResolvedValue(null),
    writeCache: vi.fn().mockResolvedValue(undefined),
    isCacheStale: vi.fn().mockReturnValue(true),
  };
});

vi.mock('../background.js', () => ({
  spawnBackgroundCheck: vi.fn(),
}));

function createMockSource(version: string): VersionSource {
  return {
    name: 'mock',
    fetchLatest: vi.fn().mockResolvedValue({
      kind: 'found' as const,
      info: { version },
    }),
  };
}

describe('normalizeVersion', () => {
  it('parses standard semver', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3');
  });

  it('strips pre-release tag', () => {
    expect(normalizeVersion('2.0.0-beta.1')).toBe('2.0.0');
  });

  it('strips build metadata', () => {
    expect(normalizeVersion('1.0.0+build.123')).toBe('1.0.0');
  });

  it('strips both pre-release and build metadata', () => {
    expect(normalizeVersion('3.1.0-alpha.2+sha.45678')).toBe('3.1.0');
  });

  it('coerces v-prefixed version', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
  });

  it('coerces partial version', () => {
    expect(normalizeVersion('v2')).toBe('2.0.0');
  });

  it('coerces two-segment version', () => {
    expect(normalizeVersion('1.5')).toBe('1.5.0');
  });

  it('returns null for unparseable string', () => {
    expect(normalizeVersion('not-a-version')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeVersion('')).toBeNull();
  });
});

describe('version comparison via checkUpdate', () => {
  const baseConfig = {
    appName: 'test-app',
    currentVersion: '1.0.0',
    cacheDir: '/tmp/cache',
    sources: [] as VersionSource[],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects update when latest > current', async () => {
    const config = { ...baseConfig, sources: [createMockSource('1.1.0')] };
    const status = await checkUpdate(config, 'blocking');
    expect(status.kind).toBe('available');
    if (status.kind === 'available') {
      expect(status.current).toBe('1.0.0');
      expect(status.latest).toBe('1.1.0');
    }
  });

  it('reports up-to-date when versions match', async () => {
    const config = { ...baseConfig, sources: [createMockSource('1.0.0')] };
    const status = await checkUpdate(config, 'blocking');
    expect(status.kind).toBe('up-to-date');
  });

  it('reports up-to-date when current is newer', async () => {
    const config = { ...baseConfig, currentVersion: '2.0.0', sources: [createMockSource('1.0.0')] };
    const status = await checkUpdate(config, 'blocking');
    expect(status.kind).toBe('up-to-date');
  });

  it('treats 2.0.0-beta.1 vs 2.0.0 as up-to-date after normalization', async () => {
    const config = {
      ...baseConfig,
      currentVersion: '2.0.0-beta.1',
      sources: [createMockSource('2.0.0')],
    };
    const status = await checkUpdate(config, 'blocking');
    expect(status.kind).toBe('up-to-date');
  });

  it('handles v-prefixed versions', async () => {
    const source: VersionSource = {
      name: 'mock',
      fetchLatest: vi.fn().mockResolvedValue({
        kind: 'found' as const,
        info: { version: 'v2.0.0' },
      }),
    };
    const config = { ...baseConfig, currentVersion: 'v1.0.0', sources: [source] };
    const status = await checkUpdate(config, 'blocking');
    expect(status.kind).toBe('available');
  });

  it('handles coerced partial versions', async () => {
    const config = {
      ...baseConfig,
      currentVersion: '1',
      sources: [createMockSource('1.0.1')],
    };
    const status = await checkUpdate(config, 'blocking');
    expect(status.kind).toBe('available');
  });

  it('returns unknown for unparseable current version', async () => {
    const config = {
      ...baseConfig,
      currentVersion: 'invalid',
      sources: [createMockSource('1.0.0')],
    };
    const status = await checkUpdate(config, 'blocking');
    expect(status.kind).toBe('unknown');
  });

  it('returns unknown for unparseable latest version', async () => {
    const source: VersionSource = {
      name: 'mock',
      fetchLatest: vi.fn().mockResolvedValue({
        kind: 'found' as const,
        info: { version: 'garbage' },
      }),
    };
    const config = { ...baseConfig, sources: [source] };
    const status = await checkUpdate(config, 'blocking');
    expect(status.kind).toBe('unknown');
  });
});
