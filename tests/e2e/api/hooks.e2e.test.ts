// tests/e2e/api/hooks.e2e.test.ts
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

describe("E2E: Hooks", () => {
  let env: TestEnvironment | undefined;
  let fetchMock: ReturnType<typeof setupFetchMock> | undefined;

  afterEach(async () => {
    fetchMock?.restore();
    await env?.cleanup();
  });

  it("beforeCheck returns false → check is skipped (no fetch calls made)", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([]); // No routes — any fetch would throw

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      hooks: {
        beforeCheck: () => false,
      },
    });

    const result = await kit.autoUpdate();
    // Check was skipped so status is unknown → up-to-date result
    expect(result.kind).toBe("up-to-date");
    // No fetch calls should have been made
    expect(fetchMock.calls().length).toBe(0);
  });

  it("beforeCheck returns true → check proceeds normally", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    let beforeCheckCalled = false;
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      hooks: {
        beforeCheck: () => {
          beforeCheckCalled = true;
          return true;
        },
      },
    });

    await kit.checkUpdate("blocking");
    expect(beforeCheckCalled).toBe(true);
    expect(fetchMock.calls().length).toBeGreaterThan(0);
  });

  it("beforeApply returns false → apply is skipped", async () => {
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
      hooks: {
        beforeApply: () => false,
      },
    });

    const result = await kit.autoUpdate();
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.message).toMatch(/skip/i);
    }
  });

  it("beforeApply receives plan object with kind, fromVersion, toVersion", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    let receivedPlan: unknown;
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      hooks: {
        beforeApply: (plan) => {
          receivedPlan = plan;
          return false; // Skip actual apply
        },
      },
    });

    await kit.autoUpdate();

    expect(receivedPlan).toBeDefined();
    const plan = receivedPlan as Record<string, unknown>;
    expect(plan).toHaveProperty("kind");
    expect(plan).toHaveProperty("fromVersion");
    expect(plan).toHaveProperty("toVersion");
    const kind = plan.kind as Record<string, unknown>;
    expect(kind).toHaveProperty("type");
    expect(plan.fromVersion).toBe("1.0.0");
    expect(plan.toVersion).toBe("2.0.0");
  });

  it("afterApply receives result object with kind", async () => {
    env = await createTestEnvironment({ channel: "npm-global" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    let receivedResult: unknown;
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      npmPackageName: "test-app",
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      delegateMode: "print-only",
      hooks: {
        afterApply: (result) => {
          receivedResult = result;
        },
      },
    });

    await kit.autoUpdate();

    expect(receivedResult).toBeDefined();
    const result = receivedResult as Record<string, unknown>;
    expect(result).toHaveProperty("kind");
    expect(typeof result.kind).toBe("string");
  });

  it("onError receives UpdateKitError when delegate command is disallowed", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([]);

    let receivedError: unknown;
    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      hooks: {
        onError: (error) => {
          receivedError = error;
        },
      },
    });

    // Use a disallowed command — validateCommand throws UpdateKitError which
    // propagates to applyUpdate's catch block and calls onError
    const plan = {
      kind: {
        type: "delegate-command" as const,
        channel: "native" as const,
        command: ["curl", "-L", "https://example.com/install.sh"], // curl is not whitelisted
        mode: "execute" as const,
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "exit-after-apply" as const,
    };

    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
    expect(receivedError).toBeDefined();
    const err = receivedError as { name: string; code: string };
    expect(err.name).toBe("UpdateKitError");
    expect(typeof err.code).toBe("string");
  });

  it("async hooks (Promise-returning) work correctly", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
    ]);

    const callLog: string[] = [];

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      hooks: {
        beforeCheck: async () => {
          await Promise.resolve();
          callLog.push("beforeCheck");
          return true;
        },
        beforeApply: async (plan) => {
          await Promise.resolve();
          callLog.push("beforeApply");
          return false; // Skip apply to avoid actual network calls
        },
      },
    });

    await kit.autoUpdate();

    expect(callLog).toContain("beforeCheck");
    expect(callLog).toContain("beforeApply");
  });
});
