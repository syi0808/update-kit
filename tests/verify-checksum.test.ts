import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHECKSUM_MISMATCH,
  CHECKSUM_MISSING,
  INSECURE_URL,
  verifyChecksum,
} from "../dist/index.mjs";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dist-verify-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("verifyChecksum edge cases", () => {
  it("throws CHECKSUM_MISSING when no checksum info provided", async () => {
    const filePath = join(tmpDir, "verify-no-checksum.txt");
    writeFileSync(filePath, "content");

    await expect(verifyChecksum(filePath, {})).rejects.toThrow(
      expect.objectContaining({ code: CHECKSUM_MISSING }),
    );
  });

  it("throws CHECKSUM_MISMATCH for incorrect expected checksum", async () => {
    const filePath = join(tmpDir, "verify-mismatch.txt");
    writeFileSync(filePath, "content");

    await expect(
      verifyChecksum(filePath, { expectedChecksum: "0".repeat(64) }),
    ).rejects.toThrow(expect.objectContaining({ code: CHECKSUM_MISMATCH }));
  });

  it("succeeds with correct expected checksum", async () => {
    const filePath = join(tmpDir, "verify-correct.txt");
    writeFileSync(filePath, "hello world\n");
    const correctHash =
      "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447";

    await expect(
      verifyChecksum(filePath, { expectedChecksum: correctHash }),
    ).resolves.toBeUndefined();
  });

  it("succeeds with uppercase expected checksum", async () => {
    const filePath = join(tmpDir, "verify-upper.txt");
    writeFileSync(filePath, "hello world\n");
    const upperHash =
      "A948904F2F0F479B8F8197694B30184B0D2ED1C1CD2A1EC0FB85D299A192A447";

    await expect(
      verifyChecksum(filePath, { expectedChecksum: upperHash }),
    ).resolves.toBeUndefined();
  });

  it("throws INSECURE_URL for http checksum URL", async () => {
    const filePath = join(tmpDir, "verify-insecure.txt");
    writeFileSync(filePath, "content");

    await expect(
      verifyChecksum(filePath, { checksumUrl: "http://example.com/checksum" }),
    ).rejects.toThrow(expect.objectContaining({ code: INSECURE_URL }));
  });
});
