import { describe, it, expect } from 'vitest';
import {
  selectAsset,
  expandAssetPattern,
  getPlatformAliases,
  getArchAliases,
} from '../index.js';
import type { ResolvedUpdateKitConfig } from '../../config.js';
import type { AssetInfo } from '../../checker/sources/index.js';

// ──────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────

function config(overrides?: Partial<ResolvedUpdateKitConfig>): ResolvedUpdateKitConfig {
  return { appName: 'test-app', currentVersion: '1.0.0', ...overrides };
}

function multiPlatformAssets(): AssetInfo[] {
  return [
    { name: 'test-app-darwin-arm64.tar.gz', url: 'https://dl.example.com/darwin-arm64.tar.gz', checksumUrl: 'https://dl.example.com/SHA256SUMS' },
    { name: 'test-app-darwin-x64.tar.gz', url: 'https://dl.example.com/darwin-x64.tar.gz' },
    { name: 'test-app-linux-x64.tar.gz', url: 'https://dl.example.com/linux-x64.tar.gz' },
    { name: 'test-app-linux-arm64.tar.gz', url: 'https://dl.example.com/linux-arm64.tar.gz' },
    { name: 'test-app-windows-x64.zip', url: 'https://dl.example.com/windows-x64.zip' },
  ];
}

// ──────────────────────────────────────────────
// getPlatformAliases
// ──────────────────────────────────────────────

describe('getPlatformAliases', () => {
  it('darwin includes macos, mac, osx, apple', () => {
    const aliases = getPlatformAliases('darwin');
    expect(aliases).toContain('darwin');
    expect(aliases).toContain('macos');
    expect(aliases).toContain('mac');
    expect(aliases).toContain('osx');
    expect(aliases).toContain('apple');
  });

  it('linux includes linux', () => {
    expect(getPlatformAliases('linux')).toEqual(['linux']);
  });

  it('win32 includes windows, win64', () => {
    const aliases = getPlatformAliases('win32');
    expect(aliases).toContain('win32');
    expect(aliases).toContain('windows');
    expect(aliases).toContain('win64');
  });

  it('unknown platform returns itself', () => {
    expect(getPlatformAliases('freebsd')).toEqual(['freebsd']);
  });
});

// ──────────────────────────────────────────────
// getArchAliases
// ──────────────────────────────────────────────

describe('getArchAliases', () => {
  it('x64 includes x86_64, amd64', () => {
    const aliases = getArchAliases('x64');
    expect(aliases).toContain('x64');
    expect(aliases).toContain('x86_64');
    expect(aliases).toContain('amd64');
  });

  it('arm64 includes aarch64', () => {
    const aliases = getArchAliases('arm64');
    expect(aliases).toContain('arm64');
    expect(aliases).toContain('aarch64');
  });

  it('ia32 includes x86, i386, i686', () => {
    const aliases = getArchAliases('ia32');
    expect(aliases).toContain('ia32');
    expect(aliases).toContain('x86');
    expect(aliases).toContain('i386');
    expect(aliases).toContain('i686');
  });

  it('unknown arch returns itself', () => {
    expect(getArchAliases('mips')).toEqual(['mips']);
  });
});

// ──────────────────────────────────────────────
// selectAsset — auto-match
// ──────────────────────────────────────────────

describe('selectAsset — auto-match', () => {
  it('matches darwin/arm64 asset', () => {
    const result = selectAsset(multiPlatformAssets(), config(), 'darwin', 'arm64');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-app-darwin-arm64.tar.gz');
  });

  it('matches linux/x64 asset', () => {
    const result = selectAsset(multiPlatformAssets(), config(), 'linux', 'x64');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-app-linux-x64.tar.gz');
  });

  it('matches windows/x64 asset', () => {
    const result = selectAsset(multiPlatformAssets(), config(), 'win32', 'x64');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-app-windows-x64.zip');
  });

  it('matches asset with macos alias', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-macos-arm64.tar.gz', url: 'https://example.com/macos' },
    ];
    const result = selectAsset(assetList, config(), 'darwin', 'arm64');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-app-macos-arm64.tar.gz');
  });

  it('matches asset with x86_64 alias', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-linux-x86_64.tar.gz', url: 'https://example.com/linux' },
    ];
    const result = selectAsset(assetList, config(), 'linux', 'x64');
    expect(result).not.toBeNull();
  });

  it('matches asset with aarch64 alias', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-linux-aarch64.tar.gz', url: 'https://example.com/linux-arm' },
    ];
    const result = selectAsset(assetList, config(), 'linux', 'arm64');
    expect(result).not.toBeNull();
  });

  it('case-insensitive matching', () => {
    const assetList: AssetInfo[] = [
      { name: 'TestApp-DARWIN-ARM64.tar.gz', url: 'https://example.com/upper' },
    ];
    const result = selectAsset(assetList, config(), 'darwin', 'arm64');
    expect(result).not.toBeNull();
  });

  it('returns null when no asset matches', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-freebsd-riscv.tar.gz', url: 'https://example.com/freebsd' },
    ];
    const result = selectAsset(assetList, config(), 'darwin', 'arm64');
    expect(result).toBeNull();
  });

  it('returns null for empty array', () => {
    const result = selectAsset([], config(), 'darwin', 'arm64');
    expect(result).toBeNull();
  });

  it('preserves checksumUrl from matched asset', () => {
    const result = selectAsset(multiPlatformAssets(), config(), 'darwin', 'arm64');
    expect(result).not.toBeNull();
    expect(result!.checksumUrl).toBe('https://dl.example.com/SHA256SUMS');
  });
});

// ──────────────────────────────────────────────
// selectAsset — assetPattern
// ──────────────────────────────────────────────

describe('selectAsset — assetPattern', () => {
  it('matches using {app} placeholder', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-darwin-arm64.tar.gz', url: 'https://example.com/1' },
      { name: 'other-app-darwin-arm64.tar.gz', url: 'https://example.com/2' },
    ];
    const result = selectAsset(
      assetList,
      config({ assetPattern: '{app}-{platform}-{arch}.tar.gz' }),
      'darwin',
      'arm64',
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-app-darwin-arm64.tar.gz');
  });

  it('matches using {version} placeholder', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-2.0.0-darwin-arm64.tar.gz', url: 'https://example.com/v2' },
    ];
    const result = selectAsset(
      assetList,
      config({ assetPattern: '{app}-{version}-{platform}-{arch}.tar.gz' }),
      'darwin',
      'arm64',
    );
    expect(result).not.toBeNull();
  });

  it('matches using {target} placeholder (platform-arch)', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-darwin-arm64.tar.gz', url: 'https://example.com/target' },
    ];
    const result = selectAsset(
      assetList,
      config({ assetPattern: '{app}-{target}.tar.gz' }),
      'darwin',
      'arm64',
    );
    expect(result).not.toBeNull();
  });

  it('matches using {ext} placeholder for tar.gz', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-darwin-arm64.tar.gz', url: 'https://example.com/targz' },
    ];
    const result = selectAsset(
      assetList,
      config({ assetPattern: '{app}-{platform}-{arch}.{ext}' }),
      'darwin',
      'arm64',
    );
    expect(result).not.toBeNull();
  });

  it('matches using {ext} placeholder for zip', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-windows-x64.zip', url: 'https://example.com/zip' },
    ];
    const result = selectAsset(
      assetList,
      config({ assetPattern: '{app}-{platform}-{arch}.{ext}' }),
      'win32',
      'x64',
    );
    expect(result).not.toBeNull();
  });

  it('assetPattern takes priority over auto-match', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-darwin-arm64.tar.gz', url: 'https://example.com/auto' },
      { name: 'custom-name-macos-arm64.tar.gz', url: 'https://example.com/pattern' },
    ];
    // Pattern only matches the custom name
    const result = selectAsset(
      assetList,
      config({ assetPattern: 'custom-name-{platform}-{arch}.tar.gz' }),
      'darwin',
      'arm64',
    );
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://example.com/pattern');
  });

  it('falls back to auto-match when pattern does not match', () => {
    const assetList: AssetInfo[] = [
      { name: 'test-app-darwin-arm64.tar.gz', url: 'https://example.com/auto' },
    ];
    const result = selectAsset(
      assetList,
      config({ assetPattern: 'nonexistent-{platform}-{arch}.tar.gz' }),
      'darwin',
      'arm64',
    );
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://example.com/auto');
  });
});

// ──────────────────────────────────────────────
// expandAssetPattern
// ──────────────────────────────────────────────

describe('expandAssetPattern', () => {
  it('produces a regex that matches expected filenames', () => {
    const regex = expandAssetPattern(
      '{app}-{version}-{target}.{ext}',
      config(),
      'darwin',
      'arm64',
    );
    expect(regex.test('test-app-2.0.0-darwin-arm64.tar.gz')).toBe(true);
    expect(regex.test('test-app-2.0.0-linux-x64.tar.gz')).toBe(false);
  });

  it('escapes special characters in appName', () => {
    const regex = expandAssetPattern(
      '{app}-{platform}-{arch}.tar.gz',
      config({ appName: 'my.app+plus' }),
      'linux',
      'x64',
    );
    expect(regex.test('my.app+plus-linux-x64.tar.gz')).toBe(true);
    expect(regex.test('myXappXplus-linux-x64.tar.gz')).toBe(false);
  });

  it('matches platform aliases in {platform}', () => {
    const regex = expandAssetPattern(
      '{app}-{platform}-{arch}.tar.gz',
      config(),
      'darwin',
      'arm64',
    );
    expect(regex.test('test-app-macos-arm64.tar.gz')).toBe(true);
    expect(regex.test('test-app-darwin-arm64.tar.gz')).toBe(true);
  });

  it('matches arch aliases in {arch}', () => {
    const regex = expandAssetPattern(
      '{app}-{platform}-{arch}.tar.gz',
      config(),
      'linux',
      'x64',
    );
    expect(regex.test('test-app-linux-x64.tar.gz')).toBe(true);
    expect(regex.test('test-app-linux-amd64.tar.gz')).toBe(true);
    expect(regex.test('test-app-linux-x86_64.tar.gz')).toBe(true);
  });
});
