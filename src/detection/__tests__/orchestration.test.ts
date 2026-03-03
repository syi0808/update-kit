import { realpath } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallDetection } from "../../types.js";

// Mock fs/promises (only realpath is used by index.ts directly)
vi.mock("node:fs/promises", () => ({
  realpath: vi.fn((p: string) => Promise.resolve(p)),
}));

// Mock all sub-modules so we can control orchestration
vi.mock("../receipt.js", () => ({
  detectFromReceipt: vi.fn(),
}));
vi.mock("../brew.js", () => ({
  detectFromBrew: vi.fn(),
}));
vi.mock("../npm.js", () => ({
  detectFromNpm: vi.fn(),
}));
vi.mock("../heuristics.js", () => ({
  collectPathHeuristics: vi.fn(() => []),
}));

import { detectFromBrew } from "../brew.js";
import { collectPathHeuristics } from "../heuristics.js";
import { detectInstall } from "../index.js";
import { detectFromNpm } from "../npm.js";
import { detectFromReceipt } from "../receipt.js";

const mockReceipt = vi.mocked(detectFromReceipt);
const mockBrew = vi.mocked(detectFromBrew);
const mockNpm = vi.mocked(detectFromNpm);
const mockHeuristics = vi.mocked(collectPathHeuristics);
const mockRealpath = vi.mocked(realpath);

const brewDetection: InstallDetection = {
  channel: "brew-cask",
  confidence: "high",
  evidence: [{ source: "brew_list", detail: "verified" }],
};

const npmDetection: InstallDetection = {
  channel: "npm-global",
  confidence: "high",
  evidence: [{ source: "npm_prefix", detail: "matched" }],
};

const receiptDetection: InstallDetection = {
  channel: "native",
  confidence: "high",
  evidence: [{ source: "receipt", detail: "found" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRealpath.mockImplementation((p) => Promise.resolve(p as string));
  mockReceipt.mockResolvedValue(null);
  mockBrew.mockResolvedValue(null);
  mockNpm.mockResolvedValue(null);
  mockHeuristics.mockReturnValue([]);
});

// ──────────────────────────────────────────────
// Custom detectors
// ──────────────────────────────────────────────

describe("detectInstall — custom detectors", () => {
  it("returns result from first matching custom detector", async () => {
    const customResult: InstallDetection = {
      channel: "native",
      confidence: "high",
      evidence: [{ source: "custom", detail: "my-detector" }],
    };

    const result = await detectInstall("/usr/bin/app", {
      appName: "app",
      customDetectors: [{ detect: vi.fn().mockResolvedValue(customResult) }],
    });

    expect(result).toEqual(customResult);
    // Built-in detectors should NOT be called
    expect(mockReceipt).not.toHaveBeenCalled();
    expect(mockBrew).not.toHaveBeenCalled();
    expect(mockNpm).not.toHaveBeenCalled();
  });

  it("skips custom detector that returns null and tries next", async () => {
    const customResult: InstallDetection = {
      channel: "native",
      confidence: "medium",
      evidence: [{ source: "custom-2", detail: "second" }],
    };

    const result = await detectInstall("/usr/bin/app", {
      appName: "app",
      customDetectors: [
        { detect: vi.fn().mockResolvedValue(null) },
        { detect: vi.fn().mockResolvedValue(customResult) },
      ],
    });

    expect(result).toEqual(customResult);
    expect(mockReceipt).not.toHaveBeenCalled();
  });

  it("skips custom detector that throws and tries next", async () => {
    const customResult: InstallDetection = {
      channel: "native",
      confidence: "medium",
      evidence: [{ source: "custom-ok", detail: "works" }],
    };

    const result = await detectInstall("/usr/bin/app", {
      appName: "app",
      customDetectors: [
        { detect: vi.fn().mockRejectedValue(new Error("detector crash")) },
        { detect: vi.fn().mockResolvedValue(customResult) },
      ],
    });

    expect(result).toEqual(customResult);
  });

  it("falls through all custom detectors to built-in when all return null", async () => {
    mockReceipt.mockResolvedValue(receiptDetection);

    const result = await detectInstall("/usr/bin/app", {
      appName: "app",
      customDetectors: [
        { detect: vi.fn().mockResolvedValue(null) },
        { detect: vi.fn().mockResolvedValue(null) },
      ],
    });

    expect(result).toEqual(receiptDetection);
    expect(mockReceipt).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// Pipeline priority
// ──────────────────────────────────────────────

describe("detectInstall — pipeline priority", () => {
  it("uses receipt result and skips brew/npm", async () => {
    mockReceipt.mockResolvedValue(receiptDetection);

    const result = await detectInstall("/usr/bin/app", { appName: "app" });

    expect(result).toEqual(receiptDetection);
    expect(mockBrew).not.toHaveBeenCalled();
    expect(mockNpm).not.toHaveBeenCalled();
  });

  it("uses brew result when receipt is null", async () => {
    mockBrew.mockResolvedValue(brewDetection);

    const result = await detectInstall("/opt/homebrew/bin/app", {
      appName: "app",
    });

    expect(result).toEqual(brewDetection);
    expect(mockReceipt).toHaveBeenCalled();
    expect(mockNpm).not.toHaveBeenCalled();
  });

  it("uses npm result when receipt and brew are null", async () => {
    mockNpm.mockResolvedValue(npmDetection);

    const result = await detectInstall("/usr/lib/node_modules/.bin/app", {
      appName: "app",
    });

    expect(result).toEqual(npmDetection);
    expect(mockReceipt).toHaveBeenCalled();
    expect(mockBrew).toHaveBeenCalled();
  });

  it("falls back to unmanaged when all detectors return null", async () => {
    const result = await detectInstall("/some/path/app", { appName: "app" });

    expect(result.channel).toBe("unmanaged");
    expect(mockReceipt).toHaveBeenCalled();
    expect(mockBrew).toHaveBeenCalled();
    expect(mockNpm).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// Fallback confidence
// ──────────────────────────────────────────────

describe("detectInstall — fallback confidence", () => {
  it('returns "low" confidence when heuristics find evidence', async () => {
    mockHeuristics.mockReturnValue([
      { source: "path_hint", detail: "/usr/local/bin" },
    ]);

    const result = await detectInstall("/usr/local/bin/app", {
      appName: "app",
    });

    expect(result.channel).toBe("unmanaged");
    expect(result.confidence).toBe("low");
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "path_hint" }),
      ]),
    );
  });

  it('returns "none" confidence when heuristics find no evidence', async () => {
    mockHeuristics.mockReturnValue([]);

    const result = await detectInstall("/unknown/path/app", {
      appName: "app",
    });

    expect(result.channel).toBe("unmanaged");
    expect(result.confidence).toBe("none");
  });
});

// ──────────────────────────────────────────────
// realpath failure
// ──────────────────────────────────────────────

describe("detectInstall — realpath failure", () => {
  it("uses original execPath when realpath throws", async () => {
    mockRealpath.mockRejectedValue(new Error("ENOENT"));
    mockBrew.mockResolvedValue(brewDetection);

    const execPath = "/opt/homebrew/bin/app";
    const result = await detectInstall(execPath, { appName: "app" });

    expect(result).toEqual(brewDetection);
    // Verify that the original execPath was passed (not a resolved one)
    expect(mockBrew).toHaveBeenCalledWith(execPath, expect.any(Object));
  });
});
