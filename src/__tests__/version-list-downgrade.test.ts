import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FetchVersionsOptions,
  VersionSource,
} from "../checker/sources/index.js";
import type {
  ResolvedUpdateKitConfig,
  VersionSourceConfig,
} from "../config.js";
import { UpdateKit } from "../index.js";
import type { PlanUpdateOptions } from "../planner/index.js";
import type { UpdatePlan } from "../types.js";

// Mock all external dependencies
vi.mock("../detection/index.js", () => ({
  detectInstall: vi.fn().mockResolvedValue({
    channel: "npm-global",
    confidence: "high",
    evidence: [],
  }),
}));

vi.mock("../checker/index.js", () => ({
  checkUpdate: vi.fn().mockResolvedValue({
    kind: "up-to-date",
    current: "2.0.0",
  }),
  normalizeVersion: vi.fn((v: string) => v),
}));

vi.mock("../applier/native.js", () => ({
  applyNativeUpdate: vi.fn(),
}));

vi.mock("../applier/delegate.js", () => ({
  applyDelegateUpdate: vi.fn().mockResolvedValue({
    kind: "success",
    fromVersion: "2.0.0",
    toVersion: "1.0.0",
    postAction: "exit-after-apply",
    command: ["npm", "install", "-g", "test-app@1.0.0"],
  }),
}));

vi.mock("../ux/hooks.js", () => ({
  runHook: vi.fn().mockResolvedValue(true),
}));

vi.mock("../platform/paths.js", () => ({
  getDefaultCacheDir: vi.fn().mockReturnValue("/tmp/cache"),
}));

vi.mock("../ux/index.js", () => ({
  renderBanner: vi.fn(),
  renderProgress: vi.fn(),
  renderResult: vi.fn(),
}));

vi.mock("../utils/package-json.js", () => ({
  findPackageJson: vi.fn(),
  findPackageJsonSync: vi.fn(),
  findPackageJsonFromModule: vi.fn(),
  findPackageJsonFromModuleSync: vi.fn(),
  getCallerFilePath: vi.fn(),
  resolvePackageJsonFromCaller: vi.fn(),
}));

// We need to mock createVersionSource to control fetchVersions behavior
vi.mock("../checker/sources/index.js", () => ({
  listVersions: vi.fn(
    async (source: VersionSource, options?: FetchVersionsOptions) => {
      if (!source.fetchVersions) {
        return {
          kind: "error",
          reason: `Source "${source.name}" does not support version listing`,
        };
      }
      return source.fetchVersions(options);
    },
  ),
  createVersionSource: vi.fn((config: VersionSourceConfig) => {
    if (config.type === "npm") {
      return {
        name: "npm",
        fetchLatest: vi.fn(),
        fetchVersions: vi.fn().mockResolvedValue({
          kind: "success",
          versions: [
            { version: "3.0.0", publishedAt: "2024-03-01T00:00:00Z" },
            { version: "2.0.0", publishedAt: "2024-02-01T00:00:00Z" },
            { version: "1.0.0", publishedAt: "2024-01-01T00:00:00Z" },
          ],
          totalCount: 3,
        }),
      };
    }
    if (config.type === "brew") {
      return {
        name: "brew",
        fetchLatest: vi.fn(),
        // No fetchVersions — brew does not support it
      };
    }
    return {
      name: "mock",
      fetchLatest: vi.fn(),
    };
  }),
}));

vi.mock("../planner/index.js", () => ({
  planUpdate: vi.fn(
    (
      _status: unknown,
      _detection: unknown,
      config: ResolvedUpdateKitConfig,
      options?: PlanUpdateOptions,
    ) => {
      const targetVersion = options?.targetVersion;
      if (!targetVersion) return null;
      return {
        kind: {
          type: "delegate-command",
          channel: "npm-global",
          command: [
            "npm",
            "install",
            "-g",
            `${config.appName}@${targetVersion}`,
          ],
          mode: config.delegateMode ?? "print-only",
        },
        fromVersion: config.currentVersion,
        toVersion: targetVersion,
        postAction: "exit-after-apply",
      } satisfies UpdatePlan;
    },
  ),
}));

import { applyDelegateUpdate } from "../applier/delegate.js";
import { createVersionSource } from "../checker/sources/index.js";
import { detectInstall as detectInstallFn } from "../detection/index.js";
import { planUpdate as planUpdateFn } from "../planner/index.js";

const mockDetectInstall = vi.mocked(detectInstallFn);
const mockPlanUpdate = vi.mocked(planUpdateFn);
const mockApplyDelegate = vi.mocked(applyDelegateUpdate);
const mockCreateVersionSource = vi.mocked(createVersionSource);

describe("UpdateKit.listVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-setup the default mock since clearAllMocks resets them
    mockDetectInstall.mockResolvedValue({
      channel: "npm-global",
      confidence: "high",
      evidence: [],
    });
  });

  it("returns versions from the first source that supports fetchVersions", async () => {
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    const result = await kit.listVersions({ limit: 10 });
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.versions.length).toBe(3);
      expect(result.versions[0].version).toBe("3.0.0");
      expect(result.versions[2].version).toBe("1.0.0");
    }
  });

  it("passes options through to fetchVersions", async () => {
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    await kit.listVersions({ limit: 5, cursor: "abc" });

    // The source's fetchVersions should have been called with the options
    const source = mockCreateVersionSource.mock.results[0].value;
    expect(source.fetchVersions).toHaveBeenCalledWith({
      limit: 5,
      cursor: "abc",
    });
  });

  it("returns error when no source supports version listing", async () => {
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "brew", caskName: "test-app" }],
    });

    const result = await kit.listVersions();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("No source supports version listing");
    }
  });

  it("skips sources without fetchVersions and uses the first that has it", async () => {
    // Configure sources: brew (no fetchVersions) then npm (has fetchVersions)
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [
        { type: "brew", caskName: "test-app" },
        { type: "npm", packageName: "test-app" },
      ],
    });

    const result = await kit.listVersions();
    expect(result.kind).toBe("success");
  });
});

describe("UpdateKit.switchVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectInstall.mockResolvedValue({
      channel: "npm-global",
      confidence: "high",
      evidence: [],
    });
    mockApplyDelegate.mockResolvedValue({
      kind: "success",
      fromVersion: "2.0.0",
      toVersion: "1.0.0",
      postAction: "exit-after-apply",
      command: ["npm", "install", "-g", "test-app@1.0.0"],
    });
  });

  it("executes full downgrade pipeline and returns result", async () => {
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      delegateMode: "execute",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    const result = await kit.switchVersion("1.0.0", { execute: true });
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.toVersion).toBe("1.0.0");
    }
  });

  it("calls detectInstall during switchVersion", async () => {
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    await kit.switchVersion("1.0.0");
    expect(mockDetectInstall).toHaveBeenCalled();
  });

  it("passes targetVersion to planUpdate", async () => {
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    await kit.switchVersion("1.0.0");
    expect(mockPlanUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "up-to-date", current: "2.0.0" }),
      expect.objectContaining({ channel: "npm-global" }),
      expect.objectContaining({ appName: "test-app" }),
      expect.objectContaining({ targetVersion: "1.0.0" }),
    );
  });

  it("overrides delegateMode to execute when options.execute is true", async () => {
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      delegateMode: "print-only",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    await kit.switchVersion("1.0.0", { execute: true });
    expect(mockPlanUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ delegateMode: "execute" }),
      expect.objectContaining({ targetVersion: "1.0.0" }),
    );
  });

  it("returns failed when target equals current version", async () => {
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    const result = await kit.switchVersion("2.0.0");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.message).toContain("Already at version 2.0.0");
    }
  });

  it("returns failed when planner returns null", async () => {
    mockPlanUpdate.mockReturnValueOnce(null);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    const result = await kit.switchVersion("3.0.0");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.message).toContain("No plan could be created");
    }
  });

  it("catches errors and returns failed result", async () => {
    mockDetectInstall.mockRejectedValue(new Error("Detection failed"));

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    const result = await kit.switchVersion("1.0.0");
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.message).toBe("Detection failed");
      expect(result.rollbackSucceeded).toBe(false);
    }
  });

  it("works for upgrades too (not just downgrades)", async () => {
    mockApplyDelegate.mockResolvedValue({
      kind: "success",
      fromVersion: "2.0.0",
      toVersion: "3.0.0",
      postAction: "exit-after-apply",
      command: ["npm", "install", "-g", "test-app@3.0.0"],
    });

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    const result = await kit.switchVersion("3.0.0");
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.toVersion).toBe("3.0.0");
    }
  });
});

// Import the new types and functions from the public API entry point
import type { VersionListResult } from "../index.js";
import { listVersions } from "../index.js";

describe("public API exports", () => {
  it("exports FetchVersionsOptions type", () => {
    const opts: FetchVersionsOptions = { limit: 10 };
    expect(opts.limit).toBe(10);
  });

  it("exports VersionListResult type", () => {
    const result: VersionListResult = { kind: "error", reason: "test" };
    expect(result.kind).toBe("error");
  });

  it("exports listVersions standalone function", () => {
    expect(typeof listVersions).toBe("function");
  });

  it("exports PlanUpdateOptions type", () => {
    const opts: PlanUpdateOptions = { targetVersion: "1.0.0" };
    expect(opts.targetVersion).toBe("1.0.0");
  });
});
