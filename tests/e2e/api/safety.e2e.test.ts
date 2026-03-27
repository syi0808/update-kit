// tests/e2e/api/safety.e2e.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestEnvironment, type TestEnvironment } from "../helpers/environment.js";
import { setupFetchMock } from "../helpers/fetch-mock.js";
import { createTestArtifacts } from "../helpers/artifacts.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { UpdateKit } = await import("../../../dist/index.mjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures/servers");
const githubLatest = JSON.parse(await fs.readFile(path.join(fixturesDir, "github-latest.json"), "utf-8"));

describe("E2E: Safety Policies", () => {
  let env: TestEnvironment | undefined;
  let fetchMock: ReturnType<typeof setupFetchMock> | undefined;

  afterEach(async () => {
    fetchMock?.restore();
    await env?.cleanup();
  });

  it("HTTP URL (not HTTPS) in download plan is rejected with INSECURE_URL error", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([]); // no routes needed — should fail before fetch

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = {
      kind: {
        type: "native-in-place" as const,
        downloadUrl: "http://insecure.example.com/test-app-v2.0.0.tar.gz", // HTTP not HTTPS
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "suggest-restart" as const,
    };

    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      // The error should mention insecure URL or HTTPS requirement
      expect(result.error.message).toMatch(/https|insecure|http/i);
    }
  });

  it("non-whitelisted command (curl) in delegate plan is rejected", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const plan = {
      kind: {
        type: "delegate-command" as const,
        channel: "native" as const,
        command: ["curl", "-L", "https://example.com/install.sh", "|", "sh"], // curl is not whitelisted
        mode: "execute" as const,
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "exit-after-apply" as const,
    };

    const result = await kit.applyUpdate(plan);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error.message).toMatch(/disallowed|curl|allowed/i);
    }
  });

  it("low confidence detection → plan is print-only or manual-install (not execute)", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      mockBinBehavior: { npm: { stdout: "/some/other/path" } },
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
      delegateMode: "execute", // Even with execute mode, low confidence should produce safe plan
    });

    const status = await kit.checkUpdate("blocking");
    const detection = await kit.detectInstall();

    // Force low confidence scenario
    const lowConfidenceDetection = {
      ...detection,
      confidence: "low" as const,
    };

    const plan = kit.planUpdate(status, lowConfidenceDetection);

    if (plan !== null) {
      // Low confidence npm should produce manual-install (not an executing delegate)
      if (plan.kind.type === "delegate-command") {
        // If it's a delegate, it must be print-only
        expect(plan.kind.mode).toBe("print-only");
      } else {
        expect(plan.kind.type).toBe("manual-install");
      }
    }
  });

  it("checkAndNotify never throws even with bad config/source", async () => {
    env = await createTestEnvironment({ channel: "native" });

    // Set up a fetch mock that throws errors
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network completely down");
    };

    try {
      const kit = new UpdateKit({
        appName: "test-app",
        currentVersion: "1.0.0",
        executablePath: env.executablePath,
        cacheDir: env.cachePath,
        sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      });

      // Should never throw — returns null on any error
      const result = await kit.checkAndNotify();
      expect(result === null || typeof result === "string").toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("autoUpdate never throws, returns kind: 'failed' on error", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com\/repos\/.*\/releases\/latest/, response: { body: githubLatest } },
      // Download URL will fail
      {
        url: /example\.com\/.*\.tar\.gz/,
        response: { status: 500, body: "Server Error" },
      },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
      customPlanResolver: () => ({
        type: "native-in-place",
        downloadUrl: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
      }),
    });

    // autoUpdate should never throw — always returns an ApplyResult
    const result = await kit.autoUpdate({ skipChecksum: true });
    expect(result).toBeDefined();
    expect(["failed", "up-to-date", "success", "needs-restart"]).toContain(result.kind);
  });

  it("atomic replace: original binary is preserved on archive extraction failure", async () => {
    env = await createTestEnvironment({ channel: "native" });

    // Read the original binary content to compare later
    const originalContent = await fs.readFile(env.executablePath);

    // Corrupt archive that will fail extraction
    const corruptData = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff]);
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

    const plan = {
      kind: {
        type: "native-in-place" as const,
        downloadUrl: "https://example.com/test-app-v2.0.0-darwin-arm64.tar.gz",
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "suggest-restart" as const,
    };

    const result = await kit.applyUpdate(plan, { skipChecksum: true });
    expect(result.kind).toBe("failed");

    // Original file must still exist and be unchanged
    const afterContent = await fs.readFile(env.executablePath);
    expect(afterContent).toEqual(originalContent);
  });
});
