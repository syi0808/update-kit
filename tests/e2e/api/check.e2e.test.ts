// tests/e2e/api/check.e2e.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestEnvironment, type TestEnvironment } from "../helpers/environment.js";
import { setupFetchMock } from "../helpers/fetch-mock.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { UpdateKit } = await import("../../../dist/index.mjs");

// Load fixture responses
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures/servers");
const githubLatest = JSON.parse(await fs.readFile(path.join(fixturesDir, "github-latest.json"), "utf-8"));
const npmRegistry = JSON.parse(await fs.readFile(path.join(fixturesDir, "npm-registry.json"), "utf-8"));
const jsrPackage = JSON.parse(await fs.readFile(path.join(fixturesDir, "jsr-package.json"), "utf-8"));
const brewCask = JSON.parse(await fs.readFile(path.join(fixturesDir, "brew-cask.json"), "utf-8"));
const customManifest = JSON.parse(await fs.readFile(path.join(fixturesDir, "custom-manifest.json"), "utf-8"));

describe("E2E: Check", () => {
  let env: TestEnvironment | undefined;
  let fetchMock: ReturnType<typeof setupFetchMock> | undefined;

  afterEach(async () => {
    fetchMock?.restore();
    await env?.cleanup();
  });

  it("blocking check via GitHub source returns available", async () => {
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
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("2.0.0");
      expect(status.current).toBe("1.0.0");
    }
  });

  it("blocking check via npm source returns up-to-date", async () => {
    env = await createTestEnvironment({ channel: "npm-global", currentVersion: "2.0.0" });
    // npm fetchLatest hits /{packageName}/latest which returns a single version object
    fetchMock = setupFetchMock([
      { url: /registry\.npmjs\.org\/.*\/latest/, response: { body: { version: "2.0.0" } } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "2.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "npm", packageName: "test-app" }],
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("up-to-date");
  });

  it("blocking check via JSR source returns available", async () => {
    env = await createTestEnvironment({ channel: "native" });
    // JSR fetchLatest hits https://jsr.io/@{scope}/{name}/meta.json
    fetchMock = setupFetchMock([
      { url: /jsr\.io\/@.*\/meta\.json/, response: { body: jsrPackage } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "jsr", scope: "test-org", name: "test-app" }],
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");
  });

  it("blocking check via Brew source returns available", async () => {
    env = await createTestEnvironment({ channel: "brew-cask" });
    fetchMock = setupFetchMock([
      { url: /formulae\.brew\.sh\//, response: { body: brewCask } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "brew", caskName: "test-app" }],
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");
  });

  it("blocking check via custom manifest returns available", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: "https://test-app.example.com/manifest.json", response: { body: customManifest } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "custom", url: "https://test-app.example.com/manifest.json" }],
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");
  });

  it("non-blocking returns fresh cache immediately", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([]); // No routes — should not be called

    // Pre-seed cache
    const cacheEntryDir = path.join(env.cachePath, "test-app");
    await fs.mkdir(cacheEntryDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheEntryDir, "update-check.json"),
      JSON.stringify({
        latestVersion: "2.0.0",
        currentVersionAtCheck: "1.0.0",
        lastCheckedAt: new Date().toISOString(),
        source: "github",
      }),
    );

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const status = await kit.checkUpdate("non-blocking");
    expect(status.kind).toBe("available");
    // No fetch calls should have been made for the version check itself
    // (background process may be spawned but won't hit our in-process mock)
  });

  it("non-blocking with stale cache returns cached result", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([]); // background check is a child process, won't hit this

    // Pre-seed stale cache (old date)
    const cacheEntryDir = path.join(env.cachePath, "test-app");
    await fs.mkdir(cacheEntryDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheEntryDir, "update-check.json"),
      JSON.stringify({
        latestVersion: "1.5.0",
        currentVersionAtCheck: "1.0.0",
        lastCheckedAt: "2020-01-01T00:00:00Z", // very stale
        source: "github",
      }),
    );

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const status = await kit.checkUpdate("non-blocking");
    // Should return cached result even though stale
    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("1.5.0");
    }
  });

  it("non-blocking with no cache returns unknown", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const status = await kit.checkUpdate("non-blocking");
    expect(status.kind).toBe("unknown");
  });

  it("blocking check with all sources failing returns unknown", async () => {
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

  it("blocking check with ETag 304 reuses cache", async () => {
    env = await createTestEnvironment({ channel: "native" });

    // Pre-seed cache with etag
    const cacheEntryDir = path.join(env.cachePath, "test-app");
    await fs.mkdir(cacheEntryDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheEntryDir, "update-check.json"),
      JSON.stringify({
        latestVersion: "2.0.0",
        currentVersionAtCheck: "1.0.0",
        lastCheckedAt: "2020-01-01T00:00:00Z", // stale to force re-fetch
        source: "github",
        etag: '"abc123"',
      }),
    );

    fetchMock = setupFetchMock([
      { url: /api\.github\.com/, response: { status: 304, headers: { etag: '"abc123"' } } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [{ type: "github", owner: "test-org", repo: "test-app" }],
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.latest).toBe("2.0.0");
    }
  });

  it("blocking check falls back to second source when first fails", async () => {
    env = await createTestEnvironment({ channel: "native" });
    fetchMock = setupFetchMock([
      { url: /api\.github\.com/, response: { status: 500, body: "error" } },
      { url: /registry\.npmjs\.org\/.*\/latest/, response: { body: { version: "2.0.0" } } },
    ]);

    const kit = new UpdateKit({
      appName: "test-app",
      currentVersion: "1.0.0",
      executablePath: env.executablePath,
      cacheDir: env.cachePath,
      sources: [
        { type: "github", owner: "test-org", repo: "test-app" },
        { type: "npm", packageName: "test-app" },
      ],
    });

    const status = await kit.checkUpdate("blocking");
    expect(status.kind).toBe("available");
  });
});
