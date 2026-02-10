import { describe, it, expect, beforeAll } from "vitest";
import { UpdateKit } from "../dist/index.mjs";
import type { UpdateStatus, InstallDetection } from "../dist/index.mjs";

describe("UpdateKit instance method shapes", () => {
  let kit: InstanceType<typeof UpdateKit>;

  beforeAll(() => {
    kit = new UpdateKit({ appName: "shape-test", currentVersion: "1.0.0" });
  });

  it("has detectInstall method", () => {
    expect(typeof kit.detectInstall).toBe("function");
  });

  it("has checkUpdate method", () => {
    expect(typeof kit.checkUpdate).toBe("function");
  });

  it("has planUpdate method", () => {
    expect(typeof kit.planUpdate).toBe("function");
  });

  it("has applyUpdate method", () => {
    expect(typeof kit.applyUpdate).toBe("function");
  });

  it("has checkAndNotify method", () => {
    expect(typeof kit.checkAndNotify).toBe("function");
  });

  it("has autoUpdate method", () => {
    expect(typeof kit.autoUpdate).toBe("function");
  });

  it("planUpdate returns null for up-to-date status", () => {
    const status: UpdateStatus = { kind: "up-to-date", current: "1.0.0" };
    const detection: InstallDetection = {
      channel: "npm-global",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).toBeNull();
  });

  it("planUpdate returns null for unknown status", () => {
    const status: UpdateStatus = { kind: "unknown", reason: "no cache" };
    const detection: InstallDetection = {
      channel: "native",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).toBeNull();
  });

  it("planUpdate returns a plan for available status with npm-global channel", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "npm-global",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("delegate-command");
    expect(plan!.fromVersion).toBe("1.0.0");
    expect(plan!.toVersion).toBe("2.0.0");
  });

  it("planUpdate returns delegate-command for brew-cask channel", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "3.0.0",
    };
    const detection: InstallDetection = {
      channel: "brew-cask",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("delegate-command");
  });

  it("planUpdate returns manual-install for unknown channel", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "some-unknown",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("planUpdate returns manual-install for low confidence npm-global", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "npm-global",
      confidence: "low",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("planUpdate returns manual-install for low confidence brew-cask", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "brew-cask",
      confidence: "low",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("planUpdate returns manual-install for native channel without assets", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "native",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("planUpdate returns manual-install for unmanaged with none confidence", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "unmanaged",
      confidence: "none",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
  });

  it("delegate-command plan has correct postAction", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "npm-global",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan!.postAction).toBe("exit-after-apply");
  });

  it("manual-install plan has none postAction", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "some-unknown",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan!.postAction).toBe("none");
  });
});

describe("Delegate command plan structure", () => {
  it("npm-global plan command includes package name and version", () => {
    const kit = new UpdateKit({
      appName: "my-cli",
      currentVersion: "1.0.0",
      npmPackageName: "my-npm-pkg",
    });
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "3.0.0",
    };
    const detection: InstallDetection = {
      channel: "npm-global",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("delegate-command");
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.command).toContain("npm");
      expect(plan!.kind.command).toContain("my-npm-pkg@3.0.0");
      expect(plan!.kind.mode).toBe("print-only");
    }
  });

  it("npm-global plan uses appName when npmPackageName is not set", () => {
    const kit = new UpdateKit({
      appName: "fallback-name",
      currentVersion: "1.0.0",
    });
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "npm-global",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.command).toContain("fallback-name@2.0.0");
    }
  });

  it("brew-cask plan command includes cask name", () => {
    const kit = new UpdateKit({
      appName: "my-app",
      currentVersion: "1.0.0",
      brewCaskName: "my-brew-cask",
    });
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "4.0.0",
    };
    const detection: InstallDetection = {
      channel: "brew-cask",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.command).toContain("brew");
      expect(plan!.kind.command).toContain("my-brew-cask");
    }
  });

  it("brew-cask plan uses appName when brewCaskName is not set", () => {
    const kit = new UpdateKit({
      appName: "brew-fallback",
      currentVersion: "1.0.0",
    });
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "brew-cask",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.command).toContain("brew-fallback");
    }
  });

  it("uses execute mode when delegateMode is set to execute", () => {
    const kit = new UpdateKit({
      appName: "test",
      currentVersion: "1.0.0",
      delegateMode: "execute",
    });
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const detection: InstallDetection = {
      channel: "npm-global",
      confidence: "high",
      evidence: [],
    };
    const plan = kit.planUpdate(status, detection);
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.mode).toBe("execute");
    }
  });
});
