import { beforeEach, describe, expect, it, vi } from "vitest";
import { APPLY_FAILED } from "../../errors.js";

// Mock node:fs/promises to control Windows replace behavior
vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    chmod: vi.fn().mockResolvedValue(undefined),
    constants: { W_OK: 2 },
  },
}));

import fs from "node:fs/promises";
import { atomicReplace } from "../replace.js";

const mockFs = vi.mocked(fs);
const originalPlatform = process.platform;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process, "platform", { value: "win32" });
  mockFs.access.mockResolvedValue(undefined);
  mockFs.rename.mockResolvedValue(undefined);
  mockFs.copyFile.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("atomicReplace — Windows (mocked fs)", () => {
  it("throws APPLY_FAILED when both copy and rollback fail", async () => {
    const copyError = new Error("disk full");
    const rollbackError = new Error("file locked");

    // First rename: target -> .old (succeeds)
    // copyFile: fails
    // Second rename: .old -> target (rollback fails)
    let renameCallCount = 0;
    mockFs.rename.mockImplementation(async () => {
      renameCallCount++;
      if (renameCallCount === 1) return; // target -> .old succeeds
      throw rollbackError; // rollback fails
    });
    mockFs.copyFile.mockRejectedValue(copyError);

    await expect(
      atomicReplace("/tmp/new-app", "/tmp/app.exe"),
    ).rejects.toThrow(
      expect.objectContaining({
        code: APPLY_FAILED,
        message: expect.stringContaining("disk full"),
      }),
    );
  });

  it("restores original on copy failure when rollback succeeds", async () => {
    const copyError = new Error("disk full");

    // First rename: target -> .old (succeeds)
    // copyFile: fails
    // Second rename: .old -> target (succeeds = rollback)
    mockFs.rename.mockResolvedValue(undefined);
    mockFs.copyFile.mockRejectedValue(copyError);

    await expect(
      atomicReplace("/tmp/new-app", "/tmp/app.exe"),
    ).rejects.toThrow("disk full");
  });

  it("tolerates .old cleanup failure after successful update", async () => {
    // Pre-existing .old unlink: succeeds
    // rename target -> .old: succeeds
    // copyFile: succeeds
    // Final .old unlink: fails (non-fatal)
    let unlinkCallCount = 0;
    mockFs.unlink.mockImplementation(async () => {
      unlinkCallCount++;
      if (unlinkCallCount === 2) throw new Error("file in use"); // final cleanup
    });

    // Should not throw despite cleanup failure
    await expect(
      atomicReplace("/tmp/new-app", "/tmp/app.exe"),
    ).resolves.toBeUndefined();
  });

  it("cleans up pre-existing .old file before starting", async () => {
    await atomicReplace("/tmp/new-app", "/tmp/app.exe");

    // First unlink call should be for the pre-existing .old file
    expect(mockFs.unlink).toHaveBeenCalledWith("/tmp/app.exe.old");
  });
});

describe("atomicReplace — Unix cleanup on failure (mocked fs)", () => {
  it("cleans up temp file when rename fails", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    const renameError = new Error("permission denied");
    mockFs.copyFile.mockResolvedValue(undefined);
    vi.mocked(fs.chmod).mockResolvedValue(undefined);
    mockFs.rename.mockRejectedValue(renameError);

    await expect(
      atomicReplace("/tmp/new-app", "/tmp/app"),
    ).rejects.toThrow("permission denied");

    // unlink should have been called for the temp file
    expect(mockFs.unlink).toHaveBeenCalled();
  });
});
