import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApplyResult,
  InstallDetection,
  UpdateStatus,
} from "../../types.js";
import {
  bold,
  dim,
  green,
  red,
  stripAnsi,
  supportsColor,
  yellow,
} from "../colors.js";
import { renderBanner, renderProgress, renderResult } from "../index.js";
import { defaultTemplates } from "../templates.js";

// ──────────────────────────────────────────────
// supportsColor
// ──────────────────────────────────────────────

describe("supportsColor", () => {
  const originalNoColor = process.env["NO_COLOR"];

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = originalNoColor;
    }
  });

  it("returns false when NO_COLOR is set", () => {
    process.env["NO_COLOR"] = "1";
    expect(supportsColor()).toBe(false);
  });

  it("behavior depends on TTY status in current environment", () => {
    delete process.env["NO_COLOR"];
    // In non-TTY (e.g., CI), supportsColor returns false
    // In TTY (terminal), supportsColor returns true
    const result = supportsColor();
    expect(result).toBe(process.stdout.isTTY === true);
  });
});

// ──────────────────────────────────────────────
// Color functions
// ──────────────────────────────────────────────

describe("color functions", () => {
  it("strips ANSI codes", () => {
    const colored = "\x1b[1mhello\x1b[0m";
    expect(stripAnsi(colored)).toBe("hello");
  });

  it("bold, red, green, yellow, dim all return strings", () => {
    expect(typeof bold("a")).toBe("string");
    expect(typeof red("b")).toBe("string");
    expect(typeof green("c")).toBe("string");
    expect(typeof yellow("d")).toBe("string");
    expect(typeof dim("e")).toBe("string");
  });
});

// ──────────────────────────────────────────────
// defaultTemplates
// ──────────────────────────────────────────────

describe("defaultTemplates", () => {
  it("updateAvailable without command", () => {
    const msg = defaultTemplates.updateAvailable({
      current: "1.0.0",
      latest: "2.0.0",
    });
    expect(msg).toContain("1.0.0");
    expect(msg).toContain("2.0.0");
    expect(msg).not.toContain("Run ");
  });

  it("updateAvailable with command", () => {
    const msg = defaultTemplates.updateAvailable({
      current: "1.0.0",
      latest: "2.0.0",
      command: "npm update -g my-app",
    });
    expect(msg).toContain("npm update -g my-app");
  });

  it("updateInProgress without progress", () => {
    const msg = defaultTemplates.updateInProgress({ phase: "downloading" });
    expect(msg).toContain("downloading");
    expect(msg).not.toContain("%");
  });

  it("updateInProgress with progress", () => {
    const msg = defaultTemplates.updateInProgress({
      phase: "downloading",
      progress: 0.5,
    });
    expect(msg).toContain("50%");
  });

  it("updateSuccess with suggest-restart", () => {
    const msg = defaultTemplates.updateSuccess({
      version: "2.0.0",
      postAction: "suggest-restart",
    });
    expect(msg).toContain("restart");
  });

  it("updateSuccess with exit-after-apply", () => {
    const msg = defaultTemplates.updateSuccess({
      version: "2.0.0",
      postAction: "exit-after-apply",
    });
    expect(msg).toContain("exit");
  });

  it("updateSuccess with none postAction", () => {
    const msg = defaultTemplates.updateSuccess({
      version: "2.0.0",
      postAction: "none",
    });
    expect(msg).toContain("2.0.0");
    expect(msg).not.toContain("restart");
    expect(msg).not.toContain("exit");
  });

  it("updateFailed", () => {
    const msg = defaultTemplates.updateFailed({ error: "oops" });
    expect(msg).toContain("oops");
  });

  it("manualInstruction without downloadUrl", () => {
    const msg = defaultTemplates.manualInstruction({
      instructions: "Download from website",
    });
    expect(msg).toBe("Download from website");
  });

  it("manualInstruction with downloadUrl", () => {
    const msg = defaultTemplates.manualInstruction({
      instructions: "Download from website",
      downloadUrl: "https://example.com/app",
    });
    expect(msg).toContain("https://example.com/app");
  });
});

// ──────────────────────────────────────────────
// renderBanner
// ──────────────────────────────────────────────

describe("renderBanner", () => {
  const detection: InstallDetection = {
    channel: "npm-global",
    confidence: "high",
    evidence: [],
  };

  it("returns null for up-to-date status", () => {
    const status: UpdateStatus = { kind: "up-to-date", current: "1.0.0" };
    expect(renderBanner(status, detection)).toBeNull();
  });

  it("returns null for unknown status", () => {
    const status: UpdateStatus = { kind: "unknown", reason: "timeout" };
    expect(renderBanner(status, detection)).toBeNull();
  });

  it("returns banner string for available status", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const banner = renderBanner(status, detection);
    expect(banner).not.toBeNull();
    expect(stripAnsi(banner!)).toContain("1.0.0");
    expect(stripAnsi(banner!)).toContain("2.0.0");
  });

  it("includes update command for npm-global", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const banner = renderBanner(status, detection);
    expect(stripAnsi(banner!)).toContain("npm update -g");
  });

  it("includes brew command for brew-cask", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const brewDetection: InstallDetection = {
      channel: "brew-cask",
      confidence: "high",
      evidence: [],
    };
    const banner = renderBanner(status, brewDetection);
    expect(stripAnsi(banner!)).toContain("brew upgrade");
  });

  it("no command for native channel", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    const nativeDetection: InstallDetection = {
      channel: "native",
      confidence: "high",
      evidence: [],
    };
    const banner = renderBanner(status, nativeDetection);
    expect(stripAnsi(banner!)).not.toContain("Run ");
  });
});

// ──────────────────────────────────────────────
// renderProgress
// ──────────────────────────────────────────────

describe("renderProgress", () => {
  it("renders downloading with totalBytes", () => {
    const msg = renderProgress({
      phase: "downloading",
      bytesDownloaded: 500,
      totalBytes: 1000,
    });
    expect(msg).toContain("50%");
  });

  it("renders downloading without totalBytes", () => {
    const msg = renderProgress({
      phase: "downloading",
      bytesDownloaded: 500,
    });
    expect(msg).toContain("downloading");
    expect(msg).not.toContain("%");
  });

  it("renders non-downloading phase", () => {
    const msg = renderProgress({ phase: "verifying" });
    expect(msg).toContain("verifying");
  });
});

// ──────────────────────────────────────────────
// renderResult
// ──────────────────────────────────────────────

describe("renderResult", () => {
  it("renders success", () => {
    const result: ApplyResult = {
      kind: "success",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "suggest-restart",
    };
    const msg = stripAnsi(renderResult(result));
    expect(msg).toContain("2.0.0");
  });

  it("renders up-to-date", () => {
    const result: ApplyResult = {
      kind: "up-to-date",
      current: "1.0.0",
    };
    const msg = stripAnsi(renderResult(result));
    expect(msg).toContain("up to date");
  });

  it("renders needs-restart", () => {
    const result: ApplyResult = {
      kind: "needs-restart",
      message: "Please restart",
    };
    const msg = stripAnsi(renderResult(result));
    expect(msg).toContain("Please restart");
  });

  it("renders failed", () => {
    const result: ApplyResult = {
      kind: "failed",
      error: new Error("update broke"),
      rollbackSucceeded: true,
    };
    const msg = stripAnsi(renderResult(result));
    expect(msg).toContain("update broke");
  });
});
