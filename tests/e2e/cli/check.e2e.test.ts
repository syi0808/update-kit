// tests/e2e/cli/check.e2e.test.ts
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTestEnvironment, type TestEnvironment } from "../helpers/environment.js";
import { runCLI } from "../helpers/cli-runner.js";
import { writeFetchRoutes } from "../helpers/cli-routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures/servers");

const githubLatest = JSON.parse(
  await fs.readFile(path.join(fixturesDir, "github-latest.json"), "utf-8"),
);

describe("CLI: check", () => {
  let env: TestEnvironment | undefined;

  afterEach(async () => {
    await env?.cleanup();
  });

  it("--blocking --json returns available when update exists (GitHub)", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest,
      },
    ]);

    const result = await runCLI({
      args: ["check", "--blocking", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.kind).toBe("available");
    expect(json.latest).toBe("2.0.0");
    expect(json.current).toBe("1.0.0");
  });

  it("--blocking --json returns up-to-date when current matches latest", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "2.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest, // tag_name: "v2.0.0"
      },
    ]);

    const result = await runCLI({
      args: ["check", "--blocking", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.kind).toBe("up-to-date");
  });

  it("non-blocking --json with no cache returns unknown", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    // No routes — non-blocking without cache should return unknown immediately
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["check", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.kind).toBe("unknown");
  });

  it("--json with pre-seeded cache returns cached available result", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    // No network routes needed — cache will be returned immediately
    await writeFetchRoutes(routesDir, []);

    // Pre-seed the cache
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

    const result = await runCLI({
      args: ["check", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.kind).toBe("available");
    expect(json.latest).toBe("2.0.0");
  });

  it("--background exits 0 and prints confirmation", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest,
      },
    ]);

    const result = await runCLI({
      args: ["check", "--background", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/background/i);
  });

  it("--blocking --json returns unknown when all sources fail", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: { message: "Not Found" },
        status: 404,
      },
    ]);

    const result = await runCLI({
      args: ["check", "--blocking", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.kind).toBe("unknown");
  });
});
