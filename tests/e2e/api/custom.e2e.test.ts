// tests/e2e/api/custom.e2e.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestEnvironment, type TestEnvironment } from "../helpers/environment.js";
import { setupFetchMock } from "../helpers/fetch-mock.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { UpdateKit } = await import("../../../dist/index.mjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures/servers");
const githubLatest = JSON.parse(await fs.readFile(path.join(fixturesDir, "github-latest.json"), "utf-8"));

describe("E2E: Custom Detectors and Plan Resolvers", () => {
  let env: TestEnvironment | undefined;
  let fetchMock: ReturnType<typeof setupFetchMock> | undefined;

  afterEach(async () => {
    fetchMock?.restore();
    await env?.cleanup();
  });

  it("customDetector returning 'docker' channel overrides built-in detection", async () => {
    env = await createTestEnvironment({ channel: "unmanaged" });

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      customDetectors: [
        {
          name: "docker-detector",
          detect: () => ({
            channel: "docker",
            confidence: "high",
            evidence: [{ source: "custom", detail: "Running in Docker container" }],
          }),
        },
      ],
    });

    const detection = await kit.detectInstall();
    expect(detection.channel).toBe("docker");
    expect(detection.confidence).toBe("high");
  });

  it("multiple customDetectors: first matching one wins", async () => {
    env = await createTestEnvironment({ channel: "unmanaged" });

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      customDetectors: [
        {
          name: "first-detector",
          detect: () => ({
            channel: "snap",
            confidence: "high",
            evidence: [{ source: "custom", detail: "snap detected first" }],
          }),
        },
        {
          name: "second-detector",
          detect: () => ({
            channel: "flatpak",
            confidence: "high",
            evidence: [{ source: "custom", detail: "flatpak detected second" }],
          }),
        },
      ],
    });

    const detection = await kit.detectInstall();
    expect(detection.channel).toBe("snap"); // First wins
  });

  it("customPlanResolver returning native-in-place → plan has native-in-place type", async () => {
    env = await createTestEnvironment({ channel: "npm-global" });
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
      customPlanResolver: () => ({
        type: "native-in-place",
        downloadUrl: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
        checksumUrl: "https://example.com/SHA256SUMS",
      }),
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");

    const detection = await kit.detectInstall();
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("native-in-place");
    if (plan!.kind.type === "native-in-place") {
      expect(plan!.kind.downloadUrl).toBe("https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz");
    }
  });

  it("customPlanResolver returning delegate-command → plan has delegate-command type", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      customPlanResolver: (ctx) => ({
        type: "delegate-command",
        channel: ctx.channel,
        command: ["apt-get", "install", "-y", "test-app"],
        mode: "print-only",
      }),
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");

    const detection = await kit.detectInstall();
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("delegate-command");
    if (plan!.kind.type === "delegate-command") {
      expect(plan!.kind.command[0]).toBe("apt-get");
      expect(plan!.kind.mode).toBe("print-only");
    }
  });

  it("customPlanResolver returning manual-install → plan has manual-install type", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      customPlanResolver: () => ({
        type: "manual-install",
        reason: "Custom resolver forces manual install",
        instructions: "Please visit https://example.com to update",
        downloadUrl: "https://example.com/download",
      }),
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");

    const detection = await kit.detectInstall();
    const plan = kit.planUpdate(status, detection);
    expect(plan).not.toBeNull();
    expect(plan!.kind.type).toBe("manual-install");
    if (plan!.kind.type === "manual-install") {
      expect(plan!.kind.reason).toBe("Custom resolver forces manual install");
      expect(plan!.kind.instructions).toContain("https://example.com");
    }
  });
});
