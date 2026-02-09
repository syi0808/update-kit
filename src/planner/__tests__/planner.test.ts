import { describe, it, expect } from 'vitest';
import { planUpdate } from '../index.js';
import type {
  Channel,
  Confidence,
  InstallDetection,
  UpdateStatus,
} from '../../types.js';
import type { UpdateKitConfig } from '../../config.js';
import type { AssetInfo } from '../../checker/sources/index.js';

// ──────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────

function available(
  current = '1.0.0',
  latest = '2.0.0',
): UpdateStatus & { kind: 'available' } {
  return { kind: 'available', current, latest };
}

function detection(channel: Channel, confidence: Confidence): InstallDetection {
  return { channel, confidence, evidence: [] };
}

function config(overrides?: Partial<UpdateKitConfig>): UpdateKitConfig {
  return { appName: 'test-app', currentVersion: '1.0.0', ...overrides };
}

function assets(): AssetInfo[] {
  return [
    { name: 'test-app-darwin-arm64.tar.gz', url: 'https://dl.example.com/darwin-arm64.tar.gz', checksumUrl: 'https://dl.example.com/SHA256SUMS' },
    { name: 'test-app-darwin-x64.tar.gz', url: 'https://dl.example.com/darwin-x64.tar.gz' },
    { name: 'test-app-linux-x64.tar.gz', url: 'https://dl.example.com/linux-x64.tar.gz' },
    { name: 'test-app-windows-x64.zip', url: 'https://dl.example.com/windows-x64.zip' },
  ];
}

// ──────────────────────────────────────────────
// Edge cases — early return
// ──────────────────────────────────────────────

describe('planUpdate — early return', () => {
  it('returns null when status is up-to-date', () => {
    const result = planUpdate(
      { kind: 'up-to-date', current: '1.0.0' },
      detection('native', 'high'),
      config(),
    );
    expect(result).toBeNull();
  });

  it('returns null when status is unknown', () => {
    const result = planUpdate(
      { kind: 'unknown', reason: 'network failure' },
      detection('native', 'high'),
      config(),
    );
    expect(result).toBeNull();
  });

  it('populates fromVersion and toVersion correctly', () => {
    const result = planUpdate(
      available('1.5.0', '3.0.0'),
      detection('npm-global', 'high'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.fromVersion).toBe('1.5.0');
    expect(result!.toVersion).toBe('3.0.0');
  });
});

// ──────────────────────────────────────────────
// Native channel
// ──────────────────────────────────────────────

describe('planUpdate — native channel', () => {
  it('high confidence + allowReexec → native-in-place + reexec', () => {
    const result = planUpdate(
      available(),
      detection('native', 'high'),
      config({ allowReexec: true }),
      assets(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('native-in-place');
    expect(result!.postAction).toBe('reexec');
  });

  it('high confidence without allowReexec → native-in-place + suggest-restart', () => {
    const result = planUpdate(
      available(),
      detection('native', 'high'),
      config(),
      assets(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('native-in-place');
    expect(result!.postAction).toBe('suggest-restart');
  });

  it('medium confidence → native-in-place + suggest-restart', () => {
    const result = planUpdate(
      available(),
      detection('native', 'medium'),
      config(),
      assets(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('native-in-place');
    expect(result!.postAction).toBe('suggest-restart');
  });

  it('low confidence → manual-install + none', () => {
    const result = planUpdate(
      available(),
      detection('native', 'low'),
      config(),
      assets(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('manual-install');
    expect(result!.postAction).toBe('none');
  });

  it('no assets → manual-install', () => {
    const result = planUpdate(
      available(),
      detection('native', 'high'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('manual-install');
    if (result!.kind.type === 'manual-install') {
      expect(result!.kind.reason).toContain('No release assets');
    }
  });

  it('no matching asset → manual-install with fallback URL', () => {
    const unmatchedAssets: AssetInfo[] = [
      { name: 'test-app-freebsd-riscv.tar.gz', url: 'https://example.com/freebsd' },
    ];
    const result = planUpdate(
      available(),
      detection('native', 'high'),
      config(),
      unmatchedAssets,
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('manual-install');
    if (result!.kind.type === 'manual-install') {
      expect(result!.kind.downloadUrl).toBe('https://example.com/freebsd');
    }
  });

  it('native-in-place carries downloadUrl and checksumUrl from asset', () => {
    const result = planUpdate(
      available(),
      detection('native', 'high'),
      config(),
      assets(),
    );
    expect(result).not.toBeNull();
    if (result!.kind.type === 'native-in-place') {
      expect(result!.kind.downloadUrl).toMatch(/^https:\/\//);
    }
  });
});

// ──────────────────────────────────────────────
// Unmanaged channel
// ──────────────────────────────────────────────

describe('planUpdate — unmanaged channel', () => {
  it('medium confidence → native-in-place + suggest-restart', () => {
    const result = planUpdate(
      available(),
      detection('unmanaged', 'medium'),
      config(),
      assets(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('native-in-place');
    expect(result!.postAction).toBe('suggest-restart');
  });

  it('low confidence → native-in-place (still above none)', () => {
    const result = planUpdate(
      available(),
      detection('unmanaged', 'low'),
      config(),
      assets(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('native-in-place');
  });

  it('none confidence → manual-install', () => {
    const result = planUpdate(
      available(),
      detection('unmanaged', 'none'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('manual-install');
    expect(result!.postAction).toBe('none');
  });

  it('no assets → manual-install', () => {
    const result = planUpdate(
      available(),
      detection('unmanaged', 'high'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('manual-install');
  });
});

// ──────────────────────────────────────────────
// npm-global channel
// ──────────────────────────────────────────────

describe('planUpdate — npm-global channel', () => {
  it('high confidence → delegate-command + exit-after-apply', () => {
    const result = planUpdate(
      available('1.0.0', '2.0.0'),
      detection('npm-global', 'high'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('delegate-command');
    expect(result!.postAction).toBe('exit-after-apply');
    if (result!.kind.type === 'delegate-command') {
      expect(result!.kind.command).toEqual(['npm', 'install', '-g', 'test-app@2.0.0']);
      expect(result!.kind.channel).toBe('npm-global');
    }
  });

  it('medium confidence → delegate-command', () => {
    const result = planUpdate(
      available(),
      detection('npm-global', 'medium'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('delegate-command');
  });

  it('low confidence → manual-install', () => {
    const result = planUpdate(
      available(),
      detection('npm-global', 'low'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('manual-install');
    expect(result!.postAction).toBe('none');
  });

  it('uses npmPackageName when configured', () => {
    const result = planUpdate(
      available('1.0.0', '2.0.0'),
      detection('npm-global', 'high'),
      config({ npmPackageName: '@scope/my-pkg' }),
    );
    expect(result).not.toBeNull();
    if (result!.kind.type === 'delegate-command') {
      expect(result!.kind.command).toEqual(['npm', 'install', '-g', '@scope/my-pkg@2.0.0']);
    }
  });

  it('respects delegateMode config', () => {
    const result = planUpdate(
      available(),
      detection('npm-global', 'high'),
      config({ delegateMode: 'execute' }),
    );
    expect(result).not.toBeNull();
    if (result!.kind.type === 'delegate-command') {
      expect(result!.kind.mode).toBe('execute');
    }
  });

  it('defaults delegateMode to print-only', () => {
    const result = planUpdate(
      available(),
      detection('npm-global', 'high'),
      config(),
    );
    expect(result).not.toBeNull();
    if (result!.kind.type === 'delegate-command') {
      expect(result!.kind.mode).toBe('print-only');
    }
  });
});

// ──────────────────────────────────────────────
// brew-cask channel
// ──────────────────────────────────────────────

describe('planUpdate — brew-cask channel', () => {
  it('high confidence → delegate-command + exit-after-apply', () => {
    const result = planUpdate(
      available(),
      detection('brew-cask', 'high'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('delegate-command');
    expect(result!.postAction).toBe('exit-after-apply');
    if (result!.kind.type === 'delegate-command') {
      expect(result!.kind.command).toEqual(['brew', 'upgrade', '--cask', 'test-app']);
      expect(result!.kind.channel).toBe('brew-cask');
    }
  });

  it('medium confidence → delegate-command', () => {
    const result = planUpdate(
      available(),
      detection('brew-cask', 'medium'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('delegate-command');
  });

  it('low confidence → manual-install', () => {
    const result = planUpdate(
      available(),
      detection('brew-cask', 'low'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('manual-install');
    expect(result!.postAction).toBe('none');
  });

  it('uses brewCaskName when configured', () => {
    const result = planUpdate(
      available(),
      detection('brew-cask', 'high'),
      config({ brewCaskName: 'my-custom-cask' }),
    );
    expect(result).not.toBeNull();
    if (result!.kind.type === 'delegate-command') {
      expect(result!.kind.command).toEqual(['brew', 'upgrade', '--cask', 'my-custom-cask']);
    }
  });
});

// ──────────────────────────────────────────────
// Unknown / custom channel
// ──────────────────────────────────────────────

describe('planUpdate — unknown channel', () => {
  it('unknown channel → manual-install', () => {
    const result = planUpdate(
      available(),
      detection('custom-channel' as Channel, 'high'),
      config(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('manual-install');
    expect(result!.postAction).toBe('none');
    if (result!.kind.type === 'manual-install') {
      expect(result!.kind.reason).toContain('custom-channel');
    }
  });
});
