import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKSUM_FETCH_FAILED,
  CHECKSUM_MISMATCH,
  CHECKSUM_MISSING,
  CHECKSUM_PARSE_FAILED,
  INSECURE_URL,
} from "../../errors.js";
import {
  computeSha256,
  fetchChecksumFromUrl,
  verifyChecksum,
} from "../verify.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────
// computeSha256
// ──────────────────────────────────────────────

describe("computeSha256", () => {
  it("computes correct SHA-256 for a known file", async () => {
    const content = "hello world\n";
    const filePath = path.join(tmpDir, "test.txt");
    await fs.writeFile(filePath, content);

    const expected = crypto.createHash("sha256").update(content).digest("hex");
    const result = await computeSha256(filePath);

    expect(result).toBe(expected);
  });

  it("computes correct SHA-256 for empty file", async () => {
    const filePath = path.join(tmpDir, "empty.txt");
    await fs.writeFile(filePath, "");

    const expected = crypto.createHash("sha256").update("").digest("hex");
    const result = await computeSha256(filePath);

    expect(result).toBe(expected);
  });
});

// ──────────────────────────────────────────────
// verifyChecksum — with expectedChecksum
// ──────────────────────────────────────────────

describe("verifyChecksum — expectedChecksum", () => {
  it("passes when hash matches", async () => {
    const content = "test content";
    const filePath = path.join(tmpDir, "file.bin");
    await fs.writeFile(filePath, content);

    const hash = crypto.createHash("sha256").update(content).digest("hex");

    await expect(
      verifyChecksum(filePath, { expectedChecksum: hash }),
    ).resolves.toBeUndefined();
  });

  it("throws CHECKSUM_MISMATCH when hash does not match", async () => {
    const filePath = path.join(tmpDir, "file.bin");
    await fs.writeFile(filePath, "actual content");

    const wrongHash = "a".repeat(64);

    await expect(
      verifyChecksum(filePath, { expectedChecksum: wrongHash }),
    ).rejects.toThrow(expect.objectContaining({ code: CHECKSUM_MISMATCH }));
  });

  it("handles uppercase vs lowercase hex comparison", async () => {
    const content = "case test";
    const filePath = path.join(tmpDir, "file.bin");
    await fs.writeFile(filePath, content);

    const hash = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex")
      .toUpperCase();

    await expect(
      verifyChecksum(filePath, { expectedChecksum: hash }),
    ).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// verifyChecksum — with checksumUrl
// ──────────────────────────────────────────────

describe("verifyChecksum — checksumUrl", () => {
  it("fetches and parses multi-line checksum file", async () => {
    const content = "my binary data";
    const filePath = path.join(tmpDir, "app.tar.gz");
    await fs.writeFile(filePath, content);

    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const checksumFileContent = [
      `deadbeef${"0".repeat(56)}  other-file.tar.gz`,
      `${hash}  app.tar.gz`,
    ].join("\n");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(checksumFileContent),
      }),
    );

    await expect(
      verifyChecksum(
        filePath,
        { checksumUrl: "https://example.com/SHA256SUMS" },
        { filename: "app.tar.gz" },
      ),
    ).resolves.toBeUndefined();
  });

  it("fetches and parses single-hash-only checksum file", async () => {
    const content = "single hash test";
    const filePath = path.join(tmpDir, "binary");
    await fs.writeFile(filePath, content);

    const hash = crypto.createHash("sha256").update(content).digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(hash),
      }),
    );

    await expect(
      verifyChecksum(
        filePath,
        { checksumUrl: "https://example.com/sha256" },
        { filename: "binary" },
      ),
    ).resolves.toBeUndefined();
  });

  it("throws CHECKSUM_MISMATCH when URL checksum does not match", async () => {
    const filePath = path.join(tmpDir, "file.bin");
    await fs.writeFile(filePath, "real content");

    const wrongHash = "b".repeat(64);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(wrongHash),
      }),
    );

    await expect(
      verifyChecksum(
        filePath,
        { checksumUrl: "https://example.com/sha256" },
        { filename: "file.bin" },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: CHECKSUM_MISMATCH }));
  });
});

// ──────────────────────────────────────────────
// verifyChecksum — no checksum source
// ──────────────────────────────────────────────

describe("verifyChecksum — no checksum source", () => {
  it("throws CHECKSUM_MISSING when neither expectedChecksum nor checksumUrl given", async () => {
    const filePath = path.join(tmpDir, "file.bin");
    await fs.writeFile(filePath, "data");

    await expect(verifyChecksum(filePath, {})).rejects.toThrow(
      expect.objectContaining({ code: CHECKSUM_MISSING }),
    );
  });
});

// ──────────────────────────────────────────────
// fetchChecksumFromUrl
// ──────────────────────────────────────────────

describe("fetchChecksumFromUrl", () => {
  it("throws INSECURE_URL for HTTP checksum URL", async () => {
    await expect(
      fetchChecksumFromUrl("http://example.com/SHA256SUMS", "app.tar.gz"),
    ).rejects.toThrow(expect.objectContaining({ code: INSECURE_URL }));
  });

  it("throws CHECKSUM_FETCH_FAILED on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );

    await expect(
      fetchChecksumFromUrl("https://example.com/SHA256SUMS", "app.tar.gz"),
    ).rejects.toThrow(expect.objectContaining({ code: CHECKSUM_FETCH_FAILED }));
  });

  it("throws CHECKSUM_PARSE_FAILED when filename not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`${"a".repeat(64)}  other-file.tar.gz`),
      }),
    );

    await expect(
      fetchChecksumFromUrl("https://example.com/SHA256SUMS", "app.tar.gz"),
    ).rejects.toThrow(expect.objectContaining({ code: CHECKSUM_PARSE_FAILED }));
  });

  it("matches filename with single space separator", async () => {
    const hash = "abcd".repeat(16);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`${hash} app.tar.gz`),
      }),
    );

    // Single space doesn't match the pattern (requires two or more spaces)
    // Pattern: /^([a-f0-9]{64})\s+(.+)$/i
    // \s+ matches one or more, so single space should work
    const result = await fetchChecksumFromUrl(
      "https://example.com/SHA256SUMS",
      "app.tar.gz",
    );
    expect(result).toBe(hash);
  });

  it("handles multi-line with matching filename among many", async () => {
    const hash1 = "a".repeat(64);
    const hash2 = "b".repeat(64);
    const hash3 = "c".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            [
              `${hash1}  linux-x64.tar.gz`,
              `${hash2}  darwin-arm64.tar.gz`,
              `${hash3}  windows-x64.zip`,
            ].join("\n"),
          ),
      }),
    );

    const result = await fetchChecksumFromUrl(
      "https://example.com/SHA256SUMS",
      "darwin-arm64.tar.gz",
    );
    expect(result).toBe(hash2);
  });

  it("uses default filename 'artifact' when no filename option provided", async () => {
    const content = "test content for artifact";
    const filePath = path.join(tmpDir, "artifact");
    await fs.writeFile(filePath, content);

    const hash = crypto.createHash("sha256").update(content).digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(hash),
      }),
    );

    // When verifyChecksum is called with checksumUrl but without filename option
    await expect(
      verifyChecksum(filePath, {
        checksumUrl: "https://example.com/sha256",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("computeSha256 — error handling", () => {
  it("rejects when file does not exist", async () => {
    await expect(
      computeSha256(path.join(tmpDir, "nonexistent-file")),
    ).rejects.toThrow();
  });
});
