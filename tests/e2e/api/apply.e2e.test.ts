// tests/e2e/api/apply.e2e.test.ts

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  BARE_NAME,
  createTestArtifacts,
  TAR_NAME,
  ZIP_NAME,
} from "../helpers/artifacts.js";
import {
  createTestEnvironment,
  type TestEnvironment,
} from "../helpers/environment.js";
import { setupFetchMock } from "../helpers/fetch-mock.js";

const { UpdateKit } = await import("../../../dist/index.mjs");

let artifactDir: string;
let tarGzBuffer: Buffer;
let zipBuffer: Buffer;
let bareBuffer: Buffer;
let sha256sums: string;

beforeAll(async () => {
  artifactDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "e2e-apply-artifacts-"),
  );
  await createTestArtifacts(artifactDir);
  tarGzBuffer = await fs.readFile(path.join(artifactDir, TAR_NAME));
  zipBuffer =
    process.platform !== "win32"
      ? await fs.readFile(path.join(artifactDir, ZIP_NAME))
      : tarGzBuffer; // zip not generated on Windows; reuse tar.gz
  bareBuffer = await fs.readFile(path.join(artifactDir, BARE_NAME));
  sha256sums = await fs.readFile(path.join(artifactDir, "SHA256SUMS"), "utf-8");
});

afterAll(async () => {
  await fs.rm(artifactDir, { recursive: true, force: true });
});

function nativePlan(downloadUrl: string, checksumUrl?: string) {
  return {
    kind: {
      type: "native-in-place" as const,
      downloadUrl,
      checksumUrl,
    },
    fromVersion: "1.0.0",
    toVersion: "2.0.0",
    postAction: "suggest-restart" as const,
  };
}

function delegatePlan(command: string[], mode: "print-only" | "execute") {
  return {
    kind: {
      type: "delegate-command" as const,
      channel: "npm-global",
      command,
      mode,
    },
    fromVersion: "1.0.0",
    toVersion: "2.0.0",
    postAction: "exit-after-apply" as const,
  };
}

describe("E2E: Apply", () => {
  let env: TestEnvironment | undefined;
  let fetchMock: ReturnType<typeof setupFetchMock> | undefined;

  afterEach(async () => {
    fetchMock?.restore();
    await env?.cleanup();
  });

  it("native: full download → verify → extract → replace pipeline", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      {
        url: /\.tar\.gz$/,
        response: {
          body: tarGzBuffer,
          headers: { "content-type": "application/gzip" },
        },
      },
      { url: /SHA256SUMS$/, response: { body: sha256sums } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = nativePlan(
      `https://example.com/${TAR_NAME}`,
      "https://example.com/SHA256SUMS",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("success");

    // Verify binary was replaced
    const content = await fs.readFile(env.executablePath, "utf-8");
    expect(content).toContain("v2.0.0");
  });

  it("native: tar.gz extraction", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /\.tar\.gz$/, response: { body: tarGzBuffer } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = nativePlan(`https://example.com/${TAR_NAME}`);
    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("success");
  });

  it("native: zip extraction", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /\.zip$/, response: { body: zipBuffer } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = nativePlan(`https://example.com/${ZIP_NAME}`);
    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("success");
  });

  it("native: bare binary (no archive)", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /bare$/, response: { body: bareBuffer } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = nativePlan("https://example.com/test-app-v2.0.0-bare");
    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("success");
  });

  it("native: checksum verification passes", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /\.tar\.gz$/, response: { body: tarGzBuffer } },
      { url: /SHA256SUMS$/, response: { body: sha256sums } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = nativePlan(
      `https://example.com/${TAR_NAME}`,
      "https://example.com/SHA256SUMS",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("success");
  });

  it("native: checksum mismatch → CHECKSUM_MISMATCH", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /\.tar\.gz$/, response: { body: tarGzBuffer } },
      {
        url: /SHA256SUMS$/,
        response: {
          body: `0000000000000000000000000000000000000000000000000000000000000000  ${TAR_NAME}\n`,
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

    const plan = nativePlan(
      `https://example.com/${TAR_NAME}`,
      "https://example.com/SHA256SUMS",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.code || result.error.message).toMatch(
        /CHECKSUM_MISMATCH|checksum/i,
      );
    }
  });

  it("native: download 404 → DOWNLOAD_FAILED", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /\.tar\.gz$/, response: { status: 404, body: "Not Found" } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = nativePlan(`https://example.com/${TAR_NAME}`);
    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("failed");
  });

  it("native: onProgress callback receives all phases in order", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      {
        url: /\.tar\.gz$/,
        response: {
          body: tarGzBuffer,
          headers: { "content-length": String(tarGzBuffer.length) },
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

    const phases: string[] = [];
    const plan = nativePlan(`https://example.com/${TAR_NAME}`);
    await kit.applyUpdate(plan, {
      skipChecksum: true,
      onProgress: (p: { phase: string }) => {
        if (!phases.includes(p.phase)) phases.push(p.phase);
      },
    });

    expect(phases).toContain("downloading");
    expect(phases).toContain("extracting");
    expect(phases).toContain("replacing");
    expect(phases).toContain("done");
    // Verify order
    expect(phases.indexOf("downloading")).toBeLessThan(
      phases.indexOf("extracting"),
    );
    expect(phases.indexOf("extracting")).toBeLessThan(
      phases.indexOf("replacing"),
    );
    expect(phases.indexOf("replacing")).toBeLessThan(phases.indexOf("done"));
  });

  it("native: AbortSignal cancellation", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const controller = new AbortController();

    // Abort immediately when download starts
    fetchMock = setupFetchMock([
      {
        url: /\.tar\.gz$/,
        response: { body: tarGzBuffer },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = nativePlan(`https://example.com/${TAR_NAME}`);
    controller.abort();
    const result = await kit.applyUpdate(plan, {
      skipChecksum: true,
      signal: controller.signal,
    });
    expect(result.kind).toBe("failed");
  });

  it("delegate: print-only mode returns command string", async () => {
    env = await createTestEnvironment({ channel: "npm-global" });

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      npmPackageName: "test-app",
      cacheDir: env.cachePath,
      delegateMode: "print-only",
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = delegatePlan(
      ["npm", "install", "-g", "test-app@2.0.0"],
      "print-only",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("success");
  });

  it("delegate: execute mode success", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      mockBinBehavior: {
        npm: { exitCode: 0, stdout: "updated test-app@2.0.0" },
      },
    });

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      npmPackageName: "test-app",
      cacheDir: env.cachePath,
      delegateMode: "execute",
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = delegatePlan(
      ["npm", "install", "-g", "test-app@2.0.0"],
      "execute",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("success");
  });

  it("delegate: execute mode failure → COMMAND_FAILED", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      mockBinBehavior: {
        npm: { exitCode: 1, stderr: "ERR! something went wrong" },
      },
    });

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      npmPackageName: "test-app",
      cacheDir: env.cachePath,
      delegateMode: "execute",
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = delegatePlan(
      ["npm", "install", "-g", "test-app@2.0.0"],
      "execute",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
  });

  it("delegate: permission error → PERMISSION_DENIED", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      mockBinBehavior: {
        npm: { exitCode: 1, stderr: "ERR! EACCES: permission denied" },
      },
    });

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      npmPackageName: "test-app",
      cacheDir: env.cachePath,
      delegateMode: "execute",
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = delegatePlan(
      ["npm", "install", "-g", "test-app@2.0.0"],
      "execute",
    );
    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.code || result.error.message).toMatch(
        /PERMISSION_DENIED|permission/i,
      );
    }
  });

  it("delegate: timeout → COMMAND_TIMEOUT", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      mockBinBehavior: { npm: { delayMs: 15000 } },
    });

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      npmPackageName: "test-app",
      cacheDir: env.cachePath,
      delegateMode: "execute",
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = delegatePlan(
      ["npm", "install", "-g", "test-app@2.0.0"],
      "execute",
    );
    // Very short timeout to trigger quickly
    const result = await kit.applyUpdate(plan, { timeoutMs: 500 } as any);
    expect(result.kind).toBe("failed");
  }, 10_000);

  it("delegate: AbortSignal cancellation → COMMAND_ABORTED", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      mockBinBehavior: { npm: { delayMs: 10000 } },
    });

    const controller = new AbortController();

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      npmPackageName: "test-app",
      cacheDir: env.cachePath,
      delegateMode: "execute",
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = delegatePlan(
      ["npm", "install", "-g", "test-app@2.0.0"],
      "execute",
    );
    setTimeout(() => controller.abort(), 200);
    const result = await kit.applyUpdate(plan, { signal: controller.signal });
    expect(result.kind).toBe("failed");
  }, 10_000);
});
