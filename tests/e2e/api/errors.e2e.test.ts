// tests/e2e/api/errors.e2e.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestEnvironment, type TestEnvironment } from "../helpers/environment.js";
import { setupFetchMock } from "../helpers/fetch-mock.js";
import { createTestArtifacts } from "../helpers/artifacts.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const { UpdateKit } = await import("../../../dist/index.mjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures/servers");
const githubLatest = JSON.parse(await fs.readFile(path.join(fixturesDir, "github-latest.json"), "utf-8"));

function makeNativeInPlacePlan(downloadUrl: string, checksumUrl?: string) {
  return {
    kind: {
      type: "native-in-place" as const,
      downloadUrl,
      ...(checksumUrl ? { checksumUrl } : {}),
    },
    fromVersion: "1.0.0",
    toVersion: "2.0.0",
    postAction: "suggest-restart" as const,
  };
}

describe("E2E: Error Scenarios", () => {
  let env: TestEnvironment | undefined;
  let fetchMock: ReturnType<typeof setupFetchMock> | undefined;

  afterEach(async () => {
    fetchMock?.restore();
    await env?.cleanup();
  });

  // ──────────────────────────────────────────────
  // Network errors
  // ──────────────────────────────────────────────

  it("fetch timeout → result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });

    // Override global fetch to simulate a timeout (AbortController)
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      await new Promise((_, reject) => {
        setTimeout(() => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        }, 10);
      });
      throw new Error("unreachable");
    };

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    try {
      const plan = makeNativeInPlacePlan("https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz");
      const result = await kit.applyUpdate(plan);
      expect(result.kind).toBe("failed");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("DNS failure (fetch throws TypeError) → result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed: getaddrinfo ENOTFOUND no-such-host.invalid");
    };

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    try {
      const plan = makeNativeInPlacePlan("https://no-such-host.invalid/test-app.tar.gz");
      const result = await kit.applyUpdate(plan);
      expect(result.kind).toBe("failed");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("HTTP 500 on all sources → checkUpdate returns 'unknown'", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com/, response: { status: 500, body: "Internal Server Error" } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("unknown");
  });

  it("HTTP 403 on download → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /example\.com\/.*\.tar\.gz/, response: { status: 403, body: "Forbidden" } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = makeNativeInPlacePlan(
      "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
    );
    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("failed");
  });

  it("download stream with wrong content-length → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      {
        url: /example\.com\/.*\.tar\.gz/,
        response: {
          status: 200,
          body: Buffer.from("truncated data - not a real archive"),
          headers: { "content-length": "999999" }, // lie about content length
        },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = makeNativeInPlacePlan(
      "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
    );
    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("failed");
  });

  it("empty response body → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      {
        url: /example\.com\/.*\.tar\.gz/,
        response: {
          status: 200,
          body: Buffer.from(""),
          headers: { "content-length": "0" },
        },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = makeNativeInPlacePlan(
      "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
    );
    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("failed");
  });

  // ──────────────────────────────────────────────
  // Checksum errors
  // ──────────────────────────────────────────────

  it("target filename not in SHA256SUMS → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });

    const artifactsDir = path.join(env.tmpDir, "artifacts");
    await createTestArtifacts(artifactsDir);
    const tarPath = path.join(artifactsDir, "test-app-v2.0.0-darwin-arm64.tar.gz");
    const tarContent = await fs.readFile(tarPath);

    // SHA256SUMS that doesn't include our target filename
    const sha256sums = "aabbccdd" + "a".repeat(56) + "  some-other-file.tar.gz\n";

    fetchMock = setupFetchMock([
      {
        url: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
        response: { status: 200, body: tarContent },
      },
      {
        url: "https://example.com/SHA256SUMS",
        response: { status: 200, body: sha256sums },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = makeNativeInPlacePlan(
      "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
      "https://example.com/SHA256SUMS",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
  });

  it("checksumUrl returns 404 → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });

    const artifactsDir = path.join(env.tmpDir, "artifacts");
    await createTestArtifacts(artifactsDir);
    const tarPath = path.join(artifactsDir, "test-app-v2.0.0-darwin-arm64.tar.gz");
    const tarContent = await fs.readFile(tarPath);

    fetchMock = setupFetchMock([
      {
        url: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
        response: { status: 200, body: tarContent },
      },
      {
        url: "https://example.com/SHA256SUMS",
        response: { status: 404, body: "Not Found" },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = makeNativeInPlacePlan(
      "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
      "https://example.com/SHA256SUMS",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
  });

  it("hash mismatch → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });

    const artifactsDir = path.join(env.tmpDir, "artifacts");
    await createTestArtifacts(artifactsDir);
    const tarPath = path.join(artifactsDir, "test-app-v2.0.0-darwin-arm64.tar.gz");
    const tarContent = await fs.readFile(tarPath);

    // Provide wrong hash
    const wrongHash = "a".repeat(64);
    const sha256sums = `${wrongHash}  test-app-v2.0.0-darwin-arm64.tar.gz\n`;

    fetchMock = setupFetchMock([
      {
        url: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
        response: { status: 200, body: tarContent },
      },
      {
        url: "https://example.com/SHA256SUMS",
        response: { status: 200, body: sha256sums },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = makeNativeInPlacePlan(
      "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
      "https://example.com/SHA256SUMS",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.message).toMatch(/mismatch|checksum/i);
    }
  });

  it("unparseable checksum format → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });

    const artifactsDir = path.join(env.tmpDir, "artifacts");
    await createTestArtifacts(artifactsDir);
    const tarPath = path.join(artifactsDir, "test-app-v2.0.0-darwin-arm64.tar.gz");
    const tarContent = await fs.readFile(tarPath);

    // Unparseable format (not a valid SHA256SUMS format)
    const badChecksum = "this is not a valid checksum format at all\n";

    fetchMock = setupFetchMock([
      {
        url: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
        response: { status: 200, body: tarContent },
      },
      {
        url: "https://example.com/SHA256SUMS",
        response: { status: 200, body: badChecksum },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = makeNativeInPlacePlan(
      "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
      "https://example.com/SHA256SUMS",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
  });

  // ──────────────────────────────────────────────
  // Filesystem errors
  // ──────────────────────────────────────────────

  it("corrupted tar.gz (invalid gzip bytes) → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const corruptData = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0x00, 0x00]);

    fetchMock = setupFetchMock([
      {
        url: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
        response: { status: 200, body: corruptData },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = makeNativeInPlacePlan(
      "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
    );
    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("failed");
  });

  it("read-only cache dir → checkUpdate still works (cache errors are non-fatal)", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    await fs.chmod(env.cachePath, 0o444);

    try {
      const kit = new UpdateKit({
        appName: "test-app",
        currentVersion: "1.0.0",
        executablePath: env.executablePath,
        cacheDir: env.cachePath,
        sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      });

      const status = await kit.checkUpdate("blocking");
      // Cache is read-only but the check should still return a valid result
      // (cache errors are silently ignored)
      expect(["available", "unknown"]).toContain(status.kind);
    } finally {
      await fs.chmod(env.cachePath, 0o755);
    }
  });

  it("read-only target dir → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "native" });

    const artifactsDir = path.join(env.tmpDir, "artifacts");
    await createTestArtifacts(artifactsDir);
    const tarPath = path.join(artifactsDir, "test-app-v2.0.0-darwin-arm64.tar.gz");
    const tarContent = await fs.readFile(tarPath);

    fetchMock = setupFetchMock([
      {
        url: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
        response: { status: 200, body: tarContent },
      },
    ]);

    // Make the directory containing the executable read-only
    await fs.chmod(env.appDir, 0o444);

    try {
      const kit = new UpdateKit({
        appName: "test-app",
        currentVersion: "1.0.0",
        executablePath: env.executablePath,
        cacheDir: env.cachePath,
        sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      });

      const plan = makeNativeInPlacePlan(
        "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
      );
      const result = await kit.applyUpdate(plan, { skipChecksum: true });
      expect(result.kind).toBe("failed");
    } finally {
      await fs.chmod(env.appDir, 0o755);
    }
  });

  // ──────────────────────────────────────────────
  // Delegate errors
  // ──────────────────────────────────────────────

  it("delegate command not found → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({ channel: "npm-global" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    // Remove npm from the mock bins so it can't be found
    const npmPath = path.join(env.binDir, "npm");
    await fs.unlink(npmPath);

    // Restrict PATH to only the binDir (which no longer has npm)
    const oldPath = process.env.PATH;
    process.env.PATH = env.binDir;

    try {
      const kit = new UpdateKit({
        appName: "test-app",
        currentVersion: "1.0.0",
        executablePath: env.executablePath,
        cacheDir: env.cachePath,
        npmPackageName: "test-app",
        sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
        delegateMode: "execute",
      });

      const plan = {
        kind: {
          type: "delegate-command" as const,
          channel: "npm-global" as const,
          command: ["npm", "install", "-g", "test-app@2.0.0"],
          mode: "execute" as const,
        },
        fromVersion: "1.0.0",
        toVersion: "2.0.0",
        postAction: "exit-after-apply" as const,
      };

      const result = await kit.applyUpdate(plan);
      expect(result.kind).toBe("failed");
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("npm EACCES → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      mockBinBehavior: { npm: { exitCode: 1, stderr: "npm ERR! code EACCES\nnpm ERR! permission denied" } },
    });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      npmPackageName: "test-app",
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      delegateMode: "execute",
    });

    const plan = {
      kind: {
        type: "delegate-command" as const,
        channel: "npm-global" as const,
        command: ["npm", "install", "-g", "test-app@2.0.0"],
        mode: "execute" as const,
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "exit-after-apply" as const,
    };

    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
  });

  it("delegate timeout → apply result kind is 'failed'", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      mockBinBehavior: { npm: { exitCode: 0, delayMs: 5000 } },
    });
    fetchMock = setupFetchMock([]);

    const { applyDelegateUpdate } = await import("../../../dist/index.mjs");
    const plan = {
      kind: {
        type: "delegate-command" as const,
        channel: "npm-global" as const,
        command: ["npm", "install", "-g", "test-app@2.0.0"],
        mode: "execute" as const,
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "exit-after-apply" as const,
    };

    // applyDelegateUpdate rejects on timeout — wrap in try/catch
    let result: { kind: string } | undefined;
    try {
      result = await applyDelegateUpdate(plan, { mode: "execute", timeoutMs: 100 });
    } catch (err) {
      // Timeout throws UpdateKitError — treat as failed
      result = { kind: "failed" };
    }
    expect(result?.kind).toBe("failed");
  }, 15_000);

  // ──────────────────────────────────────────────
  // Config errors
  // ──────────────────────────────────────────────

  it("invalid semver version string ('abc') → constructor throws Error", () => {
    expect(() => {
      new UpdateKit({
        appName: "test-app",
        currentVersion: "abc",
        executablePath: "/tmp/test-app",
        cacheDir: os.tmpdir(),
        sources: [{ type: "github", owner: "x", repo: "y" }],
      });
    }).toThrow(/invalid semver/i);
  });
});
