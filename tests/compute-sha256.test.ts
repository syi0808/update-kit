import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeSha256 } from "../dist/index.mjs";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dist-sha256-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("computeSha256 (Real I/O)", () => {
  it('computes correct hash for "hello world\\n"', async () => {
    const filePath = join(tmpDir, "sha256-hello.txt");
    writeFileSync(filePath, "hello world\n");
    const hash = await computeSha256(filePath);
    expect(hash).toBe(
      "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447",
    );
  });

  it("computes correct hash for empty file", async () => {
    const filePath = join(tmpDir, "sha256-empty.txt");
    writeFileSync(filePath, "");
    const hash = await computeSha256(filePath);
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("returns 64-character lowercase hex string", async () => {
    const filePath = join(tmpDir, "sha256-format.txt");
    writeFileSync(filePath, "test content");
    const hash = await computeSha256(filePath);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("computes correct hash for binary content", async () => {
    const filePath = join(tmpDir, "sha256-binary.bin");
    const buffer = Buffer.from([0x00, 0xff, 0x01, 0xfe, 0x80, 0x7f]);
    writeFileSync(filePath, buffer);
    const hash = await computeSha256(filePath);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toHaveLength(64);
  });

  it("rejects for non-existent file", async () => {
    await expect(
      computeSha256(join(tmpDir, "nonexistent-xyz-123")),
    ).rejects.toThrow();
  });

  it("produces consistent hash for same content", async () => {
    const content = "consistent test data 12345";
    const filePath1 = join(tmpDir, "sha256-consistent-1.txt");
    const filePath2 = join(tmpDir, "sha256-consistent-2.txt");
    writeFileSync(filePath1, content);
    writeFileSync(filePath2, content);

    const hash1 = await computeSha256(filePath1);
    const hash2 = await computeSha256(filePath2);
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different content", async () => {
    const filePath1 = join(tmpDir, "sha256-diff-1.txt");
    const filePath2 = join(tmpDir, "sha256-diff-2.txt");
    writeFileSync(filePath1, "content A");
    writeFileSync(filePath2, "content B");

    const hash1 = await computeSha256(filePath1);
    const hash2 = await computeSha256(filePath2);
    expect(hash1).not.toBe(hash2);
  });
});
