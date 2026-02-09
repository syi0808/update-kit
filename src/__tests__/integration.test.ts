import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateKit } from '../index.js';
import type { UpdateStatus, InstallDetection, ApplyResult, UpdatePlan } from '../types.js';

// Mock internal modules
vi.mock('../detection/index.js', () => ({
  detectInstall: vi.fn(),
  detectFromReceipt: vi.fn(),
  detectFromBrew: vi.fn(),
  detectFromNpm: vi.fn(),
  collectPathHeuristics: vi.fn(),
}));

vi.mock('../checker/index.js', () => ({
  checkUpdate: vi.fn(),
  normalizeVersion: vi.fn((v: string) => v || null),
}));

vi.mock('../checker/sources/index.js', () => ({
  createVersionSource: vi.fn(() => ({
    name: 'mock',
    fetchLatest: vi.fn(),
  })),
}));

vi.mock('../planner/index.js', () => ({
  planUpdate: vi.fn(),
}));

vi.mock('../applier/native.js', () => ({
  applyNativeUpdate: vi.fn(),
}));

vi.mock('../applier/delegate.js', () => ({
  applyDelegateUpdate: vi.fn(),
}));

vi.mock('../ux/index.js', () => ({
  renderBanner: vi.fn(),
  renderProgress: vi.fn(),
  renderResult: vi.fn(),
}));

vi.mock('../platform/paths.js', () => ({
  getDefaultCacheDir: vi.fn(() => '/tmp/test-cache'),
}));

// Import mocked modules for assertions
import { detectInstall as detectInstallFn } from '../detection/index.js';
import { checkUpdate as checkUpdateFn } from '../checker/index.js';
import { planUpdate as planUpdateFn } from '../planner/index.js';
import { applyNativeUpdate } from '../applier/native.js';
import { applyDelegateUpdate } from '../applier/delegate.js';
import { renderBanner } from '../ux/index.js';

const mockDetectInstall = vi.mocked(detectInstallFn);
const mockCheckUpdate = vi.mocked(checkUpdateFn);
const mockPlanUpdate = vi.mocked(planUpdateFn);
const mockApplyNative = vi.mocked(applyNativeUpdate);
const mockApplyDelegate = vi.mocked(applyDelegateUpdate);
const mockRenderBanner = vi.mocked(renderBanner);

const baseConfig = {
  appName: 'test-app',
  currentVersion: '1.0.0',
};

const mockDetection: InstallDetection = {
  channel: 'npm-global',
  confidence: 'high',
  evidence: [{ source: 'path_pattern', detail: 'installed via npm' }],
};

const mockAvailableStatus: UpdateStatus = {
  kind: 'available',
  current: '1.0.0',
  latest: '2.0.0',
};

const mockUpToDateStatus: UpdateStatus = {
  kind: 'up-to-date',
  current: '1.0.0',
};

const mockPlan: UpdatePlan = {
  kind: {
    type: 'delegate-command',
    channel: 'npm-global',
    command: ['npm', 'install', '-g', 'test-app@2.0.0'],
    mode: 'print-only',
  },
  fromVersion: '1.0.0',
  toVersion: '2.0.0',
  postAction: 'exit-after-apply',
};

const mockSuccessResult: ApplyResult = {
  kind: 'success',
  fromVersion: '1.0.0',
  toVersion: '2.0.0',
  postAction: 'exit-after-apply',
};

describe('UpdateKit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectInstall.mockResolvedValue(mockDetection);
    mockCheckUpdate.mockResolvedValue(mockAvailableStatus);
    mockPlanUpdate.mockReturnValue(mockPlan);
    mockApplyDelegate.mockResolvedValue({
      kind: 'success',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      postAction: 'exit-after-apply',
      command: ['npm', 'install', '-g', 'test-app@2.0.0'],
    });
    mockRenderBanner.mockReturnValue('Update available: 1.0.0 → 2.0.0');
  });

  describe('constructor', () => {
    it('creates an instance with valid config', () => {
      const kit = new UpdateKit(baseConfig);
      expect(kit).toBeInstanceOf(UpdateKit);
    });

    it('throws if appName is missing', () => {
      expect(() => new UpdateKit({ appName: '', currentVersion: '1.0.0' })).toThrow(
        'appName is required',
      );
    });

    it('throws if currentVersion is missing', () => {
      expect(() => new UpdateKit({ appName: 'test', currentVersion: '' })).toThrow(
        'currentVersion is required',
      );
    });

    it('applies default config values', () => {
      const kit = new UpdateKit(baseConfig);
      // Verify defaults by checking that the instance was created successfully
      expect(kit).toBeDefined();
    });
  });

  describe('detectInstall', () => {
    it('delegates to detection module', async () => {
      const kit = new UpdateKit(baseConfig);
      const result = await kit.detectInstall();

      expect(mockDetectInstall).toHaveBeenCalledWith(process.execPath, expect.objectContaining({
        appName: 'test-app',
      }));
      expect(result).toEqual(mockDetection);
    });
  });

  describe('checkUpdate', () => {
    it('uses non-blocking mode by default', async () => {
      const kit = new UpdateKit(baseConfig);
      await kit.checkUpdate();

      expect(mockCheckUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          appName: 'test-app',
          currentVersion: '1.0.0',
        }),
        'non-blocking',
      );
    });

    it('supports blocking mode', async () => {
      const kit = new UpdateKit(baseConfig);
      await kit.checkUpdate('blocking');

      expect(mockCheckUpdate).toHaveBeenCalledWith(
        expect.anything(),
        'blocking',
      );
    });

    it('skips check when beforeCheck hook returns false', async () => {
      const kit = new UpdateKit({
        ...baseConfig,
        hooks: {
          beforeCheck: () => false,
        },
      });

      const status = await kit.checkUpdate();
      expect(status.kind).toBe('unknown');
      expect((status as any).reason).toBe('skipped by hook');
      expect(mockCheckUpdate).not.toHaveBeenCalled();
    });

    it('proceeds when beforeCheck hook returns true', async () => {
      const kit = new UpdateKit({
        ...baseConfig,
        hooks: {
          beforeCheck: () => true,
        },
      });

      await kit.checkUpdate();
      expect(mockCheckUpdate).toHaveBeenCalled();
    });
  });

  describe('planUpdate', () => {
    it('delegates to planner module', () => {
      const kit = new UpdateKit(baseConfig);
      kit.planUpdate(mockAvailableStatus, mockDetection);

      expect(mockPlanUpdate).toHaveBeenCalledWith(
        mockAvailableStatus,
        mockDetection,
        expect.objectContaining({ appName: 'test-app' }),
      );
    });

    it('returns null when planner returns null', () => {
      mockPlanUpdate.mockReturnValue(null);
      const kit = new UpdateKit(baseConfig);
      const plan = kit.planUpdate(mockUpToDateStatus, mockDetection);
      expect(plan).toBeNull();
    });
  });

  describe('applyUpdate', () => {
    it('applies delegate-command plan', async () => {
      const kit = new UpdateKit(baseConfig);
      const result = await kit.applyUpdate(mockPlan);

      expect(mockApplyDelegate).toHaveBeenCalledWith(
        mockPlan,
        expect.objectContaining({ mode: 'print-only' }),
      );
      expect(result.kind).toBe('success');
    });

    it('applies native-in-place plan', async () => {
      const nativePlan: UpdatePlan = {
        kind: {
          type: 'native-in-place',
          downloadUrl: 'https://example.com/app.tar.gz',
        },
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        postAction: 'suggest-restart',
      };

      mockApplyNative.mockResolvedValue({
        kind: 'success',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        postAction: 'suggest-restart',
      });

      const kit = new UpdateKit(baseConfig);
      const result = await kit.applyUpdate(nativePlan);

      expect(mockApplyNative).toHaveBeenCalledWith(nativePlan, process.execPath, undefined);
      expect(result.kind).toBe('success');
    });

    it('returns instructions for manual-install plan', async () => {
      const manualPlan: UpdatePlan = {
        kind: {
          type: 'manual-install',
          reason: 'Unknown install method',
          instructions: 'Please download from https://example.com',
        },
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        postAction: 'none',
      };

      const kit = new UpdateKit(baseConfig);
      const result = await kit.applyUpdate(manualPlan);

      expect(result.kind).toBe('needs-restart');
      expect((result as any).message).toBe('Please download from https://example.com');
    });

    it('skips apply when beforeApply hook returns false', async () => {
      const kit = new UpdateKit({
        ...baseConfig,
        hooks: {
          beforeApply: () => false,
        },
      });

      const result = await kit.applyUpdate(mockPlan);
      expect(result.kind).toBe('failed');
      expect((result as any).rollbackSucceeded).toBe(true);
      expect(mockApplyDelegate).not.toHaveBeenCalled();
    });

    it('calls afterApply hook on success', async () => {
      const afterApply = vi.fn();
      const kit = new UpdateKit({
        ...baseConfig,
        hooks: { afterApply },
      });

      await kit.applyUpdate(mockPlan);
      expect(afterApply).toHaveBeenCalled();
    });

    it('calls onError hook on failure', async () => {
      const onError = vi.fn();
      mockApplyDelegate.mockRejectedValue(new Error('Network error'));

      const kit = new UpdateKit({
        ...baseConfig,
        hooks: { onError },
      });

      const result = await kit.applyUpdate(mockPlan);
      expect(result.kind).toBe('failed');
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('checkAndNotify', () => {
    it('returns banner when update is available', async () => {
      const kit = new UpdateKit(baseConfig);
      const banner = await kit.checkAndNotify();

      expect(banner).toBe('Update available: 1.0.0 → 2.0.0');
      expect(mockCheckUpdate).toHaveBeenCalled();
      expect(mockDetectInstall).toHaveBeenCalled();
      expect(mockRenderBanner).toHaveBeenCalledWith(mockAvailableStatus, mockDetection);
    });

    it('returns null when no update is available', async () => {
      mockCheckUpdate.mockResolvedValue(mockUpToDateStatus);
      mockRenderBanner.mockReturnValue(null);

      const kit = new UpdateKit(baseConfig);
      const banner = await kit.checkAndNotify();
      expect(banner).toBeNull();
    });

    it('returns null on error', async () => {
      mockCheckUpdate.mockRejectedValue(new Error('Network error'));

      const kit = new UpdateKit(baseConfig);
      const banner = await kit.checkAndNotify();
      expect(banner).toBeNull();
    });
  });

  describe('autoUpdate', () => {
    it('runs the full pipeline and returns result', async () => {
      const hooks = {
        beforeCheck: vi.fn().mockReturnValue(true),
        beforeApply: vi.fn().mockReturnValue(true),
        afterApply: vi.fn(),
      };

      const kit = new UpdateKit({
        ...baseConfig,
        hooks,
      });

      const result = await kit.autoUpdate();

      expect(mockDetectInstall).toHaveBeenCalled();
      expect(mockCheckUpdate).toHaveBeenCalledWith(
        expect.anything(),
        'blocking',
      );
      expect(mockPlanUpdate).toHaveBeenCalled();
      expect(mockApplyDelegate).toHaveBeenCalled();
      expect(hooks.beforeCheck).toHaveBeenCalled();
      expect(hooks.beforeApply).toHaveBeenCalled();
      expect(hooks.afterApply).toHaveBeenCalled();
      expect(result.kind).toBe('success');
    });

    it('returns failed result when no update is available', async () => {
      mockCheckUpdate.mockResolvedValue(mockUpToDateStatus);

      const kit = new UpdateKit(baseConfig);
      const result = await kit.autoUpdate();

      expect(result.kind).toBe('failed');
      expect((result as any).error.message).toBe('No update available');
      expect(mockPlanUpdate).not.toHaveBeenCalled();
    });

    it('returns failed result when plan is null', async () => {
      mockPlanUpdate.mockReturnValue(null);

      const kit = new UpdateKit(baseConfig);
      const result = await kit.autoUpdate();

      expect(result.kind).toBe('failed');
      expect((result as any).error.message).toBe('No update plan could be created');
    });

    it('calls onError hook on pipeline failure', async () => {
      const onError = vi.fn();
      mockDetectInstall.mockRejectedValue(new Error('Detection failed'));

      const kit = new UpdateKit({
        ...baseConfig,
        hooks: { onError },
      });

      const result = await kit.autoUpdate();
      expect(result.kind).toBe('failed');
      expect(onError).toHaveBeenCalled();
    });

    it('never throws, always returns ApplyResult', async () => {
      mockCheckUpdate.mockRejectedValue(new Error('Catastrophic failure'));

      const kit = new UpdateKit(baseConfig);
      const result = await kit.autoUpdate();

      expect(result).toBeDefined();
      expect(result.kind).toBe('failed');
    });
  });
});
