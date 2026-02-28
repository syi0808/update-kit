import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateKit } from "../index.js";
import type {
  ApplyResult,
  InstallDetection,
  UpdatePlan,
  UpdateStatus,
} from "../types.js";

// Mock internal modules
vi.mock("../detection/index.js", () => ({
  detectInstall: vi.fn(),
  detectFromReceipt: vi.fn(),
  detectFromBrew: vi.fn(),
  detectFromNpm: vi.fn(),
  collectPathHeuristics: vi.fn(),
}));

vi.mock("../checker/index.js", () => ({
  checkUpdate: vi.fn(),
  normalizeVersion: vi.fn((v: string) => v || null),
}));

vi.mock("../checker/sources/index.js", () => ({
  createVersionSource: vi.fn(() => ({
    name: "mock",
    fetchLatest: vi.fn(),
  })),
}));

vi.mock("../planner/index.js", () => ({
  planUpdate: vi.fn(),
}));

vi.mock("../applier/native.js", () => ({
  applyNativeUpdate: vi.fn(),
}));

vi.mock("../applier/delegate.js", () => ({
  applyDelegateUpdate: vi.fn(),
}));

vi.mock("../ux/index.js", () => ({
  renderBanner: vi.fn(),
  renderProgress: vi.fn(),
  renderResult: vi.fn(),
}));

vi.mock("../platform/paths.js", () => ({
  getDefaultCacheDir: vi.fn(() => "/tmp/test-cache"),
}));

vi.mock("../utils/package-json.js", () => ({
  findPackageJson: vi.fn(),
  findPackageJsonSync: vi.fn(),
  findPackageJsonFromModule: vi.fn(),
  findPackageJsonFromModuleSync: vi.fn(),
  getCallerFilePath: vi.fn(),
  resolvePackageJsonFromCaller: vi.fn(),
}));

import { applyDelegateUpdate } from "../applier/delegate.js";
import { applyNativeUpdate } from "../applier/native.js";
import { checkUpdate as checkUpdateFn } from "../checker/index.js";
// Import mocked modules for assertions
import { detectInstall as detectInstallFn } from "../detection/index.js";
import { planUpdate as planUpdateFn } from "../planner/index.js";
import {
  findPackageJsonFromModule,
  getCallerFilePath,
  resolvePackageJsonFromCaller,
} from "../utils/package-json.js";
import { renderBanner } from "../ux/index.js";

const mockDetectInstall = vi.mocked(detectInstallFn);
const mockCheckUpdate = vi.mocked(checkUpdateFn);
const mockPlanUpdate = vi.mocked(planUpdateFn);
const mockApplyNative = vi.mocked(applyNativeUpdate);
const mockApplyDelegate = vi.mocked(applyDelegateUpdate);
const mockRenderBanner = vi.mocked(renderBanner);
const mockFindPackageJsonFromModule = vi.mocked(findPackageJsonFromModule);
const mockGetCallerFilePath = vi.mocked(getCallerFilePath);
const mockResolvePackageJsonFromCaller = vi.mocked(
  resolvePackageJsonFromCaller,
);

const baseConfig = {
  appName: "test-app",
  currentVersion: "1.0.0",
};

const mockDetection: InstallDetection = {
  channel: "npm-global",
  confidence: "high",
  evidence: [{ source: "path_pattern", detail: "installed via npm" }],
};

const mockAvailableStatus: UpdateStatus = {
  kind: "available",
  current: "1.0.0",
  latest: "2.0.0",
};

const mockUpToDateStatus: UpdateStatus = {
  kind: "up-to-date",
  current: "1.0.0",
};

const mockPlan: UpdatePlan = {
  kind: {
    type: "delegate-command",
    channel: "npm-global",
    command: ["npm", "install", "-g", "test-app@2.0.0"],
    mode: "print-only",
  },
  fromVersion: "1.0.0",
  toVersion: "2.0.0",
  postAction: "exit-after-apply",
};

const mockSuccessResult: ApplyResult = {
  kind: "success",
  fromVersion: "1.0.0",
  toVersion: "2.0.0",
  postAction: "exit-after-apply",
};

describe("UpdateKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectInstall.mockResolvedValue(mockDetection);
    mockCheckUpdate.mockResolvedValue(mockAvailableStatus);
    mockPlanUpdate.mockReturnValue(mockPlan);
    mockApplyDelegate.mockResolvedValue({
      kind: "success",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "exit-after-apply",
      command: ["npm", "install", "-g", "test-app@2.0.0"],
    });
    mockRenderBanner.mockReturnValue("Update available: 1.0.0 → 2.0.0");
  });

  describe("constructor", () => {
    it("creates an instance with valid config", () => {
      const kit = new UpdateKit(baseConfig);
      expect(kit).toBeInstanceOf(UpdateKit);
    });

    it("throws if appName is missing", () => {
      expect(
        () => new UpdateKit({ appName: "", currentVersion: "1.0.0" }),
      ).toThrow("appName is required");
    });

    it("throws if currentVersion is missing", () => {
      expect(
        () => new UpdateKit({ appName: "test", currentVersion: "" }),
      ).toThrow("currentVersion is required");
    });

    it("applies default config values", () => {
      const kit = new UpdateKit(baseConfig);
      // Verify defaults by checking that the instance was created successfully
      expect(kit).toBeDefined();
    });
  });

  describe("detectInstall", () => {
    it("delegates to detection module", async () => {
      const kit = new UpdateKit(baseConfig);
      const result = await kit.detectInstall();

      expect(mockDetectInstall).toHaveBeenCalledWith(
        process.argv[1],
        expect.objectContaining({
          appName: "test-app",
        }),
      );
      expect(result).toEqual(mockDetection);
    });
  });

  describe("checkUpdate", () => {
    it("uses non-blocking mode by default", async () => {
      const kit = new UpdateKit(baseConfig);
      await kit.checkUpdate();

      expect(mockCheckUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          appName: "test-app",
          currentVersion: "1.0.0",
        }),
        "non-blocking",
      );
    });

    it("supports blocking mode", async () => {
      const kit = new UpdateKit(baseConfig);
      await kit.checkUpdate("blocking");

      expect(mockCheckUpdate).toHaveBeenCalledWith(
        expect.anything(),
        "blocking",
      );
    });

    it("skips check when beforeCheck hook returns false", async () => {
      const kit = new UpdateKit({
        ...baseConfig,
        hooks: {
          beforeCheck: () => false,
        },
      });

      const status = await kit.checkUpdate();
      expect(status.kind).toBe("unknown");
      expect((status as any).reason).toBe("skipped by hook");
      expect(mockCheckUpdate).not.toHaveBeenCalled();
    });

    it("proceeds when beforeCheck hook returns true", async () => {
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

  describe("planUpdate", () => {
    it("delegates to planner module", () => {
      const kit = new UpdateKit(baseConfig);
      kit.planUpdate(mockAvailableStatus, mockDetection);

      expect(mockPlanUpdate).toHaveBeenCalledWith(
        mockAvailableStatus,
        mockDetection,
        expect.objectContaining({ appName: "test-app" }),
      );
    });

    it("returns null when planner returns null", () => {
      mockPlanUpdate.mockReturnValue(null);
      const kit = new UpdateKit(baseConfig);
      const plan = kit.planUpdate(mockUpToDateStatus, mockDetection);
      expect(plan).toBeNull();
    });
  });

  describe("applyUpdate", () => {
    it("applies delegate-command plan", async () => {
      const kit = new UpdateKit(baseConfig);
      const result = await kit.applyUpdate(mockPlan);

      expect(mockApplyDelegate).toHaveBeenCalledWith(
        mockPlan,
        expect.objectContaining({ mode: "print-only" }),
      );
      expect(result.kind).toBe("success");
    });

    it("applies native-in-place plan", async () => {
      const nativePlan: UpdatePlan = {
        kind: {
          type: "native-in-place",
          downloadUrl: "https://example.com/app.tar.gz",
        },
        fromVersion: "1.0.0",
        toVersion: "2.0.0",
        postAction: "suggest-restart",
      };

      mockApplyNative.mockResolvedValue({
        kind: "success",
        fromVersion: "1.0.0",
        toVersion: "2.0.0",
        postAction: "suggest-restart",
      });

      const kit = new UpdateKit(baseConfig);
      const result = await kit.applyUpdate(nativePlan);

      expect(mockApplyNative).toHaveBeenCalledWith(
        nativePlan,
        process.argv[1],
        undefined,
      );
      expect(result.kind).toBe("success");
    });

    it("returns instructions for manual-install plan", async () => {
      const manualPlan: UpdatePlan = {
        kind: {
          type: "manual-install",
          reason: "Unknown install method",
          instructions: "Please download from https://example.com",
        },
        fromVersion: "1.0.0",
        toVersion: "2.0.0",
        postAction: "none",
      };

      const kit = new UpdateKit(baseConfig);
      const result = await kit.applyUpdate(manualPlan);

      expect(result.kind).toBe("needs-restart");
      expect((result as any).message).toBe(
        "Please download from https://example.com",
      );
    });

    it("skips apply when beforeApply hook returns false", async () => {
      const kit = new UpdateKit({
        ...baseConfig,
        hooks: {
          beforeApply: () => false,
        },
      });

      const result = await kit.applyUpdate(mockPlan);
      expect(result.kind).toBe("failed");
      expect((result as any).rollbackSucceeded).toBe(true);
      expect(mockApplyDelegate).not.toHaveBeenCalled();
    });

    it("calls afterApply hook on success", async () => {
      const afterApply = vi.fn();
      const kit = new UpdateKit({
        ...baseConfig,
        hooks: { afterApply },
      });

      await kit.applyUpdate(mockPlan);
      expect(afterApply).toHaveBeenCalled();
    });

    it("calls onError hook on failure", async () => {
      const onError = vi.fn();
      mockApplyDelegate.mockRejectedValue(new Error("Network error"));

      const kit = new UpdateKit({
        ...baseConfig,
        hooks: { onError },
      });

      const result = await kit.applyUpdate(mockPlan);
      expect(result.kind).toBe("failed");
      expect(onError).toHaveBeenCalled();
    });
  });

  describe("checkAndNotify", () => {
    it("returns banner when update is available", async () => {
      const kit = new UpdateKit(baseConfig);
      const banner = await kit.checkAndNotify();

      expect(banner).toBe("Update available: 1.0.0 → 2.0.0");
      expect(mockCheckUpdate).toHaveBeenCalled();
      expect(mockDetectInstall).toHaveBeenCalled();
      expect(mockRenderBanner).toHaveBeenCalledWith(
        mockAvailableStatus,
        mockDetection,
      );
    });

    it("returns null when no update is available", async () => {
      mockCheckUpdate.mockResolvedValue(mockUpToDateStatus);
      mockRenderBanner.mockReturnValue(null);

      const kit = new UpdateKit(baseConfig);
      const banner = await kit.checkAndNotify();
      expect(banner).toBeNull();
    });

    it("returns null on error", async () => {
      mockCheckUpdate.mockRejectedValue(new Error("Network error"));

      const kit = new UpdateKit(baseConfig);
      const banner = await kit.checkAndNotify();
      expect(banner).toBeNull();
    });
  });

  describe("autoUpdate", () => {
    it("runs the full pipeline and returns result", async () => {
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
        "blocking",
      );
      expect(mockPlanUpdate).toHaveBeenCalled();
      expect(mockApplyDelegate).toHaveBeenCalled();
      expect(hooks.beforeCheck).toHaveBeenCalled();
      expect(hooks.beforeApply).toHaveBeenCalled();
      expect(hooks.afterApply).toHaveBeenCalled();
      expect(result.kind).toBe("success");
    });

    it("returns up-to-date result when no update is available", async () => {
      mockCheckUpdate.mockResolvedValue(mockUpToDateStatus);

      const kit = new UpdateKit(baseConfig);
      const result = await kit.autoUpdate();

      expect(result.kind).toBe("up-to-date");
      expect(mockPlanUpdate).not.toHaveBeenCalled();
    });

    it("returns failed result when plan is null", async () => {
      mockPlanUpdate.mockReturnValue(null);

      const kit = new UpdateKit(baseConfig);
      const result = await kit.autoUpdate();

      expect(result.kind).toBe("failed");
      expect((result as any).error.message).toBe(
        "No update plan could be created",
      );
    });

    it("calls onError hook on pipeline failure", async () => {
      const onError = vi.fn();
      mockDetectInstall.mockRejectedValue(new Error("Detection failed"));

      const kit = new UpdateKit({
        ...baseConfig,
        hooks: { onError },
      });

      const result = await kit.autoUpdate();
      expect(result.kind).toBe("failed");
      expect(onError).toHaveBeenCalled();
    });

    it("never throws, always returns ApplyResult", async () => {
      mockCheckUpdate.mockRejectedValue(new Error("Catastrophic failure"));

      const kit = new UpdateKit(baseConfig);
      const result = await kit.autoUpdate();

      expect(result).toBeDefined();
      expect(result.kind).toBe("failed");
    });
  });

  describe("constructor with pkg field", () => {
    it("accepts pkg field instead of explicit appName/currentVersion", () => {
      const kit = new UpdateKit({
        pkg: { name: "pkg-app", version: "2.0.0" },
      });
      expect(kit).toBeInstanceOf(UpdateKit);
    });

    it("resolves appName from pkg.name", async () => {
      const kit = new UpdateKit({
        pkg: { name: "pkg-app", version: "2.0.0" },
      });

      await kit.detectInstall();
      expect(mockDetectInstall).toHaveBeenCalledWith(
        process.argv[1],
        expect.objectContaining({ appName: "pkg-app" }),
      );
    });

    it("resolves currentVersion from pkg.version", async () => {
      const kit = new UpdateKit({
        pkg: { name: "pkg-app", version: "3.0.0" },
      });

      await kit.checkUpdate();
      expect(mockCheckUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ currentVersion: "3.0.0" }),
        "non-blocking",
      );
    });

    it("prefers explicit appName over pkg.name", async () => {
      const kit = new UpdateKit({
        appName: "explicit-name",
        pkg: { name: "pkg-name", version: "1.0.0" },
      });

      await kit.detectInstall();
      expect(mockDetectInstall).toHaveBeenCalledWith(
        process.argv[1],
        expect.objectContaining({ appName: "explicit-name" }),
      );
    });

    it("prefers explicit currentVersion over pkg.version", async () => {
      const kit = new UpdateKit({
        appName: "test",
        currentVersion: "5.0.0",
        pkg: { name: "test", version: "1.0.0" },
      });

      await kit.checkUpdate();
      expect(mockCheckUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ currentVersion: "5.0.0" }),
        "non-blocking",
      );
    });

    it("throws when neither appName nor pkg is provided", () => {
      expect(() => new UpdateKit({ currentVersion: "1.0.0" } as any)).toThrow(
        "appName is required",
      );
    });

    it("throws when neither currentVersion nor pkg is provided", () => {
      expect(() => new UpdateKit({ appName: "test" } as any)).toThrow(
        "currentVersion is required",
      );
    });
  });

  describe("UpdateKit.create()", () => {
    it("auto-resolves from module package.json when moduleUrl is provided", async () => {
      mockFindPackageJsonFromModule.mockResolvedValue({
        name: "auto-app",
        version: "4.0.0",
        path: "/mock/package.json",
      });

      const kit = await UpdateKit.create(
        { sources: [{ type: "npm", packageName: "auto-app" }] },
        { moduleUrl: "file:///mock/src/index.js" },
      );

      expect(kit).toBeInstanceOf(UpdateKit);
      expect(mockFindPackageJsonFromModule).toHaveBeenCalledWith(
        "file:///mock/src/index.js",
      );
    });

    it("auto-resolves from caller stack when moduleUrl is not provided", async () => {
      mockGetCallerFilePath.mockReturnValue("file:///caller/src/cli.js");
      mockResolvePackageJsonFromCaller.mockResolvedValue({
        name: "caller-app",
        version: "3.0.0",
        path: "/caller/package.json",
      });

      const kit = await UpdateKit.create({
        sources: [{ type: "npm", packageName: "caller-app" }],
      });

      expect(kit).toBeInstanceOf(UpdateKit);
      expect(mockGetCallerFilePath).toHaveBeenCalled();
      expect(mockResolvePackageJsonFromCaller).toHaveBeenCalledWith(
        "file:///caller/src/cli.js",
      );
    });

    it("throws when auto-detect fails and no explicit values", async () => {
      mockGetCallerFilePath.mockReturnValue(null);

      await expect(UpdateKit.create()).rejects.toThrow(
        "Could not auto-detect package identity",
      );
    });

    it("throws when no package.json found via moduleUrl", async () => {
      mockFindPackageJsonFromModule.mockResolvedValue(null);

      await expect(
        UpdateKit.create({}, { moduleUrl: "file:///mock/src/index.js" }),
      ).rejects.toThrow("Could not auto-detect package identity");
    });

    it("throws when caller file found but no package.json nearby", async () => {
      mockGetCallerFilePath.mockReturnValue("/some/path/cli.js");
      mockResolvePackageJsonFromCaller.mockResolvedValue(null);

      await expect(UpdateKit.create()).rejects.toThrow(
        "Could not auto-detect package identity",
      );
    });

    it("skips auto-resolve when appName + currentVersion are provided", async () => {
      const kit = await UpdateKit.create({
        appName: "explicit-app",
        currentVersion: "1.0.0",
      });

      expect(kit).toBeInstanceOf(UpdateKit);
      expect(mockFindPackageJsonFromModule).not.toHaveBeenCalled();
    });

    it("skips auto-resolve when pkg is provided", async () => {
      const kit = await UpdateKit.create({
        pkg: { name: "pkg-app", version: "2.0.0" },
      });

      expect(kit).toBeInstanceOf(UpdateKit);
      expect(mockFindPackageJsonFromModule).not.toHaveBeenCalled();
    });

    it("uses resolved values for version checking", async () => {
      mockFindPackageJsonFromModule.mockResolvedValue({
        name: "resolved-app",
        version: "6.0.0",
        path: "/mock/package.json",
      });

      const kit = await UpdateKit.create(
        {},
        { moduleUrl: "file:///mock/src/index.js" },
      );
      await kit.checkUpdate();

      expect(mockCheckUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          appName: "resolved-app",
          currentVersion: "6.0.0",
        }),
        "non-blocking",
      );
    });
  });
});
