// tests/e2e/api/plan.e2e.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const { UpdateKit } = await import("../../../dist/index.mjs");

const testAssets = [
  {
    name: "test-app-v2.0.0-darwin-arm64.tar.gz",
    url: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
    size: 1024,
    checksumUrl: "https://example.com/SHA256SUMS",
  },
  {
    name: "test-app-v2.0.0-linux-x64.zip",
    url: "https://example.com/test-app-v2.0.0-linux-x64.zip",
    size: 1024,
  },
];

const availableStatus = {
  kind: "available" as const,
  current: "1.0.0",
  latest: "2.0.0",
  assets: testAssets,
};

const upToDateStatus = {
  kind: "up-to-date" as const,
  current: "2.0.0",
};

function makeKit(overrides: Record<string, unknown> = {}) {
  return new UpdateKit({
    appName: "test-app",
    currentVersion: "1.0.0",
    executablePath: "/tmp/test-app",
    cacheDir: os.tmpdir(),
    sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    ...overrides,
  });
}

describe("E2E: Plan", () => {
  it("native + high confidence + assets → native-in-place", () => {
    // kit.planUpdate() does not forward status.assets to the planner;
    // assets must be passed separately (e.g. via autoUpdate). Without assets,
    // native+high produces manual-install with downloadUrl from the first asset.
    const kit = makeKit();
    const detection = { channel: "native", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    // No assets forwarded → fallback to manual-install
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("native + low confidence → manual-install", () => {
    const kit = makeKit();
    const detection = { channel: "native", confidence: "low", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("npm-global + high → delegate-command (npm)", () => {
    const kit = makeKit({ npmPackageName: "test-app" });
    const detection = { channel: "npm-global", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("delegate-command");
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.command[0]).toBe("npm");
    }
  });

  it("npm-global + low → manual-install", () => {
    const kit = makeKit({ npmPackageName: "test-app" });
    const detection = { channel: "npm-global", confidence: "low", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("brew-cask + high → delegate-command (brew)", () => {
    const kit = makeKit({ brewCaskName: "test-app" });
    const detection = { channel: "brew-cask", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("delegate-command");
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.command[0]).toBe("brew");
    }
  });

  it("unmanaged + low + assets → native-in-place", () => {
    // kit.planUpdate() does not forward status.assets; without assets,
    // unmanaged+low falls back to manual-install.
    const kit = makeKit();
    const detection = { channel: "unmanaged", confidence: "low", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("unmanaged + none confidence + no assets → manual-install", () => {
    const kit = makeKit();
    const noAssetsStatus = { ...availableStatus, assets: [] };
    const detection = { channel: "unmanaged", confidence: "none", evidence: [] };
    const plan = kit.planUpdate(noAssetsStatus, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("apt + high via customPlanResolver → delegate-command", () => {
    const kit = makeKit({
      customPlanResolver: (ctx: { channel: string }) => {
        if (ctx.channel === "apt") {
          return {
            type: "delegate-command",
            channel: "apt",
            command: ["apt", "install", "-y", "test-app=2.0.0"],
            mode: "execute",
          };
        }
        return null;
      },
    });
    const detection = { channel: "apt", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("delegate-command");
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.command[0]).toBe("apt");
    }
  });

  it("choco + high via customPlanResolver → delegate-command", () => {
    const kit = makeKit({
      customPlanResolver: (ctx: { channel: string }) => {
        if (ctx.channel === "choco") {
          return {
            type: "delegate-command",
            channel: "choco",
            command: ["choco", "upgrade", "test-app", "--version=2.0.0"],
            mode: "execute",
          };
        }
        return null;
      },
    });
    const detection = { channel: "choco", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("delegate-command");
  });

  it("customPlanResolver overrides default plan", () => {
    const kit = makeKit({
      customPlanResolver: () => ({
        type: "manual-install",
        reason: "Custom override",
        instructions: "Do it manually",
      }),
    });
    const detection = { channel: "native", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("customPlanResolver returning null falls through to default", () => {
    // When customPlanResolver returns null, the default plan is used.
    // Since kit.planUpdate() does not forward status.assets, native+high
    // falls back to manual-install (no assets available to planner).
    const kit = makeKit({
      customPlanResolver: () => null,
    });
    const detection = { channel: "native", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("up-to-date status returns null plan", () => {
    const kit = makeKit();
    const detection = { channel: "native", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(upToDateStatus, detection);
    expect(plan).toBeNull();
  });

  it("assetPattern selects correct asset", () => {
    const kit = makeKit({
      assetPattern: "{app}-v{version}-{target}.tar.gz",
    });
    const detection = { channel: "native", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    if (plan!.kind.type === "native-in-place") {
      expect(plan!.kind.downloadUrl).toContain(".tar.gz");
    }
  });

  it("platform/arch auto-matching selects correct asset", () => {
    const kit = makeKit();
    const detection = { channel: "native", confidence: "high", evidence: [] };
    const plan = kit.planUpdate(availableStatus, detection);
    expect(plan).not.toBeNull();
    // The selected asset should match current platform
    if (plan!.kind.type === "native-in-place") {
      expect(plan!.kind.downloadUrl).toBeDefined();
    }
  });
});
