import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs/promises so we can control rename and unlink behavior
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { rename, unlink, writeFile } from "node:fs/promises";
import { atomicWriteFile } from "../fs.js";

const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);
const mockUnlink = vi.mocked(unlink);

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
});

describe("atomicWriteFile — error handling", () => {
  it("cleans up temp file and re-throws when rename fails", async () => {
    const renameError = new Error("EXDEV: cross-device link");
    mockRename.mockRejectedValueOnce(renameError);

    await expect(
      atomicWriteFile("/some/dir/test.json", "data"),
    ).rejects.toThrow("EXDEV: cross-device link");

    // writeFile should have been called (write the temp file)
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    // unlink should have been called to clean up the temp file
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it("throws original error even when temp file cleanup also fails", async () => {
    const renameError = new Error("EXDEV: cross-device link");
    mockRename.mockRejectedValueOnce(renameError);
    mockUnlink.mockRejectedValueOnce(new Error("EPERM: permission denied"));

    await expect(
      atomicWriteFile("/some/dir/test.json", "data"),
    ).rejects.toThrow("EXDEV: cross-device link");

    // Both rename and unlink were attempted
    expect(mockRename).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });
});
