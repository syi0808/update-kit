import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectFromReceipt } from "../receipt.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(() => Promise.reject(new Error("ENOENT"))),
}));

describe("detectFromReceipt", () => {
  const config = { appName: "test-app" };

  beforeEach(() => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
  });

  it("returns native + high when receipt is valid", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ appName: "test-app", channel: "native" }),
    );

    const result = await detectFromReceipt(config);
    expect(result).not.toBeNull();
    expect(result!.channel).toBe("native");
    expect(result!.confidence).toBe("high");
    expect(result!.evidence[0].source).toBe("receipt_file");
  });

  it("uses channel from receipt", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ appName: "test-app", channel: "brew-cask" }),
    );

    const result = await detectFromReceipt(config);
    expect(result!.channel).toBe("brew-cask");
  });

  it("defaults to native when channel is missing in receipt", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ appName: "test-app" }),
    );

    const result = await detectFromReceipt(config);
    expect(result!.channel).toBe("native");
  });

  it("returns null when appName does not match", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ appName: "other-app", channel: "native" }),
    );

    const result = await detectFromReceipt(config);
    expect(result).toBeNull();
  });

  it("returns null when receipt file does not exist", async () => {
    const result = await detectFromReceipt(config);
    expect(result).toBeNull();
  });

  it("returns null when receipt has invalid JSON", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("not valid json");

    const result = await detectFromReceipt(config);
    expect(result).toBeNull();
  });

  it("supports custom receiptDir", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ appName: "test-app", channel: "native" }),
    );

    const result = await detectFromReceipt(config, "/custom/dir");
    expect(result).not.toBeNull();
    expect(vi.mocked(readFile)).toHaveBeenCalledWith(
      join("/custom/dir", "install-receipt.json"),
      "utf-8",
    );
  });
});
