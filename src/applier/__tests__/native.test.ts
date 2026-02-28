import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLY_FAILED,
  DOWNLOAD_FAILED,
  EXTRACT_FAILED,
  INSECURE_URL,
  NETWORK_ERROR,
  UpdateKitError,
} from "../../errors.js";
import type { ApplyProgress, UpdatePlan } from "../../types.js";
import {
  applyNativeUpdate,
  cleanupTempDir,
  createTempDir,
  downloadArtifact,
  extractBinary,
  extractFilename,
  findBinaryInDir,
} from "../native.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "native-test-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockResponse(
  body: Uint8Array,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({
      "content-length": String(body.length),
      ...headers,
    }),
    body: stream,
  } as unknown as Response;
}

function nativePlan(
  overrides?: Partial<{
    downloadUrl: string;
    checksumUrl: string;
    expectedChecksum: string;
    fromVersion: string;
    toVersion: string;
  }>,
): UpdatePlan {
  return {
    kind: {
      type: "native-in-place",
      downloadUrl: overrides?.downloadUrl ?? "https://example.com/app.tar.gz",
      checksumUrl: overrides?.checksumUrl,
      expectedChecksum: overrides?.expectedChecksum,
    },
    fromVersion: overrides?.fromVersion ?? "1.0.0",
    toVersion: overrides?.toVersion ?? "2.0.0",
    postAction: "suggest-restart",
  };
}

// ──────────────────────────────────────────────
// extractFilename
// ──────────────────────────────────────────────

describe("extractFilename", () => {
  it("extracts filename from URL with path", () => {
    expect(extractFilename("https://example.com/releases/v1/app.tar.gz")).toBe(
      "app.tar.gz",
    );
  });

  it('returns "artifact" for URL without filename', () => {
    expect(extractFilename("https://example.com/")).toBe("artifact");
  });
});

// ──────────────────────────────────────────────
// createTempDir / cleanupTempDir
// ──────────────────────────────────────────────

describe("createTempDir / cleanupTempDir", () => {
  it("creates a temp dir in the same directory as target", async () => {
    const targetPath = path.join(tmpDir, "binary");
    const tempDir = await createTempDir(targetPath);

    expect(path.dirname(tempDir)).toBe(tmpDir);
    const stat = await fs.stat(tempDir);
    expect(stat.isDirectory()).toBe(true);

    await cleanupTempDir(tempDir);
  });

  it("cleanupTempDir removes the directory", async () => {
    const targetPath = path.join(tmpDir, "binary");
    const tempDir = await createTempDir(targetPath);
    await fs.writeFile(path.join(tempDir, "file.txt"), "data");

    await cleanupTempDir(tempDir);

    await expect(fs.access(tempDir)).rejects.toThrow();
  });

  it("cleanupTempDir does not throw for non-existent dir", async () => {
    await expect(
      cleanupTempDir(path.join(tmpDir, "nonexistent")),
    ).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// downloadArtifact
// ──────────────────────────────────────────────

describe("downloadArtifact", () => {
  it("rejects HTTP URLs with INSECURE_URL", async () => {
    await expect(
      downloadArtifact("http://example.com/app.tar.gz", tmpDir, {}),
    ).rejects.toThrow(expect.objectContaining({ code: INSECURE_URL }));
  });

  it("streams download and reports progress", async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createMockResponse(body)));

    const phases: ApplyProgress[] = [];
    const destPath = await downloadArtifact(
      "https://example.com/app.bin",
      tmpDir,
      {
        onProgress: (p) => phases.push({ ...p }),
      },
    );

    expect(destPath).toBe(path.join(tmpDir, "app.bin"));
    expect(await fs.readFile(destPath)).toEqual(Buffer.from(body));
    expect(phases.length).toBeGreaterThan(0);
    expect(phases[0]).toMatchObject({ phase: "downloading" });
  });

  it("throws DOWNLOAD_FAILED on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }),
    );

    await expect(
      downloadArtifact("https://example.com/app.tar.gz", tmpDir, {}),
    ).rejects.toThrow(expect.objectContaining({ code: DOWNLOAD_FAILED }));
  });

  it("throws DOWNLOAD_FAILED when response body is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
      }),
    );

    await expect(
      downloadArtifact("https://example.com/app.tar.gz", tmpDir, {}),
    ).rejects.toThrow(expect.objectContaining({ code: DOWNLOAD_FAILED }));
  });

  it("throws NETWORK_ERROR on fetch exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await expect(
      downloadArtifact("https://example.com/app.tar.gz", tmpDir, {}),
    ).rejects.toThrow(expect.objectContaining({ code: NETWORK_ERROR }));
  });

  it("rethrows AbortError without wrapping", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(
      downloadArtifact("https://example.com/app.tar.gz", tmpDir, {}),
    ).rejects.toThrow(abortError);
  });
});

// ──────────────────────────────────────────────
// findBinaryInDir
// ──────────────────────────────────────────────

describe("findBinaryInDir", () => {
  it("returns single file when only one exists", async () => {
    const dir = path.join(tmpDir, "extracted");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "app"), "binary");

    const result = await findBinaryInDir(dir);
    expect(result).toBe(path.join(dir, "app"));
  });

  it("prefers executable file among multiple", async () => {
    const dir = path.join(tmpDir, "extracted");
    await fs.mkdir(dir, { recursive: true });

    const readmeFile = path.join(dir, "README.txt");
    const binaryFile = path.join(dir, "app");

    await fs.writeFile(readmeFile, "readme");
    await fs.writeFile(binaryFile, "binary");
    await fs.chmod(binaryFile, 0o755);

    const result = await findBinaryInDir(dir);
    expect(result).toBe(binaryFile);
  });

  it("throws EXTRACT_FAILED for empty directory", async () => {
    const dir = path.join(tmpDir, "empty");
    await fs.mkdir(dir, { recursive: true });

    await expect(findBinaryInDir(dir)).rejects.toThrow(
      expect.objectContaining({ code: EXTRACT_FAILED }),
    );
  });
});

// ──────────────────────────────────────────────
// extractBinary
// ──────────────────────────────────────────────

describe("extractBinary", () => {
  it("handles bare binary (no archive)", async () => {
    const binaryPath = path.join(tmpDir, "app.bin");
    await fs.writeFile(binaryPath, "binary content");

    const result = await extractBinary(binaryPath, tmpDir);

    expect(path.basename(result)).toBe("app.bin");
    const content = await fs.readFile(result, "utf-8");
    expect(content).toBe("binary content");
  });
});

// ──────────────────────────────────────────────
// applyNativeUpdate — plan validation
// ──────────────────────────────────────────────

describe("applyNativeUpdate — plan validation", () => {
  it("throws APPLY_FAILED for non-native-in-place plans", async () => {
    const plan: UpdatePlan = {
      kind: {
        type: "delegate-command",
        channel: "npm-global",
        command: ["npm", "install", "-g", "app"],
        mode: "print-only",
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "exit-after-apply",
    };

    await expect(applyNativeUpdate(plan, "/usr/local/bin/app")).rejects.toThrow(
      expect.objectContaining({ code: APPLY_FAILED }),
    );
  });
});

// ──────────────────────────────────────────────
// applyNativeUpdate — full pipeline
// ──────────────────────────────────────────────

describe("applyNativeUpdate — pipeline", () => {
  it("returns success with correct fields for skipChecksum", async () => {
    const content = Buffer.from("new binary content");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createMockResponse(content)),
    );

    // Create the target file
    const targetPath = path.join(tmpDir, "app");
    await fs.writeFile(targetPath, "old binary");
    await fs.chmod(targetPath, 0o755);

    const plan = nativePlan({ downloadUrl: "https://example.com/app" });

    const phases: ApplyProgress[] = [];
    const result = await applyNativeUpdate(plan, targetPath, {
      skipChecksum: true,
      onProgress: (p) => phases.push({ ...p }),
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.fromVersion).toBe("1.0.0");
      expect(result.toVersion).toBe("2.0.0");
      expect(result.postAction).toBe("suggest-restart");
    }

    // Verify target was replaced
    const targetContent = await fs.readFile(targetPath);
    expect(targetContent).toEqual(content);

    // Verify phase progression
    const phaseNames = phases.map((p) => p.phase);
    expect(phaseNames).toContain("downloading");
    expect(phaseNames).toContain("extracting");
    expect(phaseNames).toContain("replacing");
    expect(phaseNames).toContain("done");
  });

  it("returns success with checksum verification", async () => {
    const content = Buffer.from("verified binary");
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createMockResponse(content)),
    );

    const targetPath = path.join(tmpDir, "app");
    await fs.writeFile(targetPath, "old");
    await fs.chmod(targetPath, 0o755);

    const plan = nativePlan({
      downloadUrl: "https://example.com/app",
      expectedChecksum: hash,
    });

    const result = await applyNativeUpdate(plan, targetPath);

    expect(result.kind).toBe("success");
  });

  it("returns failed result on INSECURE_URL", async () => {
    const targetPath = path.join(tmpDir, "app");
    await fs.writeFile(targetPath, "old");
    await fs.chmod(targetPath, 0o755);

    const plan: UpdatePlan = {
      kind: {
        type: "native-in-place",
        downloadUrl: "http://example.com/app",
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "suggest-restart",
    };

    const result = await applyNativeUpdate(plan, targetPath);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error).toBeInstanceOf(UpdateKitError);
      expect((result.error as UpdateKitError).code).toBe(INSECURE_URL);
      expect(result.rollbackSucceeded).toBe(true);
    }
  });

  it("cleans up temp directory on success", async () => {
    const content = Buffer.from("clean up test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createMockResponse(content)),
    );

    const targetPath = path.join(tmpDir, "app");
    await fs.writeFile(targetPath, "old");
    await fs.chmod(targetPath, 0o755);

    const plan = nativePlan({ downloadUrl: "https://example.com/app" });

    await applyNativeUpdate(plan, targetPath, { skipChecksum: true });

    // Temp directories should be cleaned up
    const entries = await fs.readdir(tmpDir);
    const tmpDirs = entries.filter((e) => e.startsWith(".update-kit-tmp-"));
    expect(tmpDirs).toHaveLength(0);
  });

  it("cleans up temp directory on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
      }),
    );

    const targetPath = path.join(tmpDir, "app");
    await fs.writeFile(targetPath, "old");
    await fs.chmod(targetPath, 0o755);

    const plan = nativePlan();

    await applyNativeUpdate(plan, targetPath, { skipChecksum: true });

    // Temp directories should be cleaned up even on failure
    const entries = await fs.readdir(tmpDir);
    const tmpDirs = entries.filter((e) => e.startsWith(".update-kit-tmp-"));
    expect(tmpDirs).toHaveLength(0);
  });
});
