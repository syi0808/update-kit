// tests/e2e/cli/cache.e2e.test.ts
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTestEnvironment, type TestEnvironment } from "../helpers/environment.js";
import { runCLI } from "../helpers/cli-runner.js";
import { writeFetchRoutes } from "../helpers/cli-routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEED_CACHE_ENTRY = {
  latestVersion: "2.0.0",
  currentVersionAtCheck: "1.0.0",
  lastCheckedAt: "2026-03-01T00:00:00Z",
  source: "github",
};

async function seedCache(cachePath: string, appName: string): Promise<void> {
  const cacheEntryDir = path.join(cachePath, appName);
  await fs.mkdir(cacheEntryDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheEntryDir, "update-check.json"),
    JSON.stringify(SEED_CACHE_ENTRY),
  );
}

describe("CLI: cache", () => {
  let env: TestEnvironment | undefined;

  afterEach(async () => {
    await env?.cleanup();
  });

  it("cache show --json with pre-seeded cache → cache contents returned", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    await seedCache(env.cachePath, "test-app");

    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["cache", "show", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.latestVersion).toBe("2.0.0");
    expect(json.source).toBe("github");
  });

  it("cache show with no cache → 'no cache' message", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    // Do NOT seed cache — should report none found

    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["cache", "show", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/no cache/i);
  });

  it("cache clear → cache file deleted, cleared confirmation", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    await seedCache(env.cachePath, "test-app");

    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["cache", "clear", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/cleared/i);

    // Verify file is actually deleted
    const cacheFile = path.join(env.cachePath, "test-app", "update-check.json");
    await expect(fs.access(cacheFile)).rejects.toThrow();
  });

  it("cache clear then show → 'no cache' message", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    await seedCache(env.cachePath, "test-app");

    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    // Clear cache
    const clearResult = await runCLI({
      args: ["cache", "clear", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });
    expect(clearResult.exitCode).toBe(0);

    // Show cache
    const showResult = await runCLI({
      args: ["cache", "show", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });
    expect(showResult.exitCode).toBe(0);
    expect(showResult.stdout).toMatch(/no cache/i);
  });
});
