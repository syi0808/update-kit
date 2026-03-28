// tests/e2e/cli/plan.e2e.test.ts

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { writeFetchRoutes } from "../helpers/cli-routes.js";
import { runCLI } from "../helpers/cli-runner.js";
import {
  createTestEnvironment,
  type TestEnvironment,
} from "../helpers/environment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../fixtures/servers");

const githubLatest = JSON.parse(
  await fs.readFile(path.join(fixturesDir, "github-latest.json"), "utf-8"),
);

const githubLatestNoAssets = JSON.parse(
  await fs.readFile(
    path.join(fixturesDir, "github-latest-no-assets.json"),
    "utf-8",
  ),
);

const npmRegistry = JSON.parse(
  await fs.readFile(path.join(fixturesDir, "npm-registry.json"), "utf-8"),
);

const brewCask = JSON.parse(
  await fs.readFile(path.join(fixturesDir, "brew-cask.json"), "utf-8"),
);

describe("CLI: plan", () => {
  let env: TestEnvironment | undefined;

  afterEach(async () => {
    await env?.cleanup();
  });

  it("--json native → type=native-in-place or manual-install when update available", async () => {
    env = await createTestEnvironment({
      channel: "native",
      currentVersion: "1.0.0",
    });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest,
      },
    ]);

    const result = await runCLI({
      args: ["plan", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    // planUpdate does not forward assets so native+high falls back to manual-install
    expect(["native-in-place", "manual-install"]).toContain(json.kind?.type);
    expect(json.fromVersion).toBe("1.0.0");
    expect(json.toVersion).toBe("2.0.0");
  });

  it("--json npm-global → type=delegate-command", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      currentVersion: "1.0.0",
    });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest,
      },
      {
        url: "registry\\.npmjs\\.org/.*/latest",
        body: { version: "2.0.0" },
      },
    ]);

    const result = await runCLI({
      args: ["plan", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.kind?.type).toBe("delegate-command");
    expect(json.kind?.command[0]).toBe("npm");
  });

  it("--json brew-cask → type=delegate-command", async () => {
    env = await createTestEnvironment({
      channel: "brew-cask",
      currentVersion: "1.0.0",
    });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest,
      },
      {
        url: "formulae\\.brew\\.sh/api/cask/.*\\.json",
        body: brewCask,
      },
    ]);

    const result = await runCLI({
      args: ["plan", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.kind?.type).toBe("delegate-command");
    expect(json.kind?.command[0]).toBe("brew");
  });

  it("--json unmanaged with no assets → type=manual-install", async () => {
    // Make npm exit 1 so detectFromNpm does not produce false-positive evidence
    // (empty MOCK_STDOUT causes `startsWith("")` to match any path).
    env = await createTestEnvironment({
      channel: "unmanaged",
      currentVersion: "1.0.0",
      mockBinBehavior: { npm: { exitCode: 1, stderr: "npm not found" } },
    });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatestNoAssets,
      },
    ]);

    const result = await runCLI({
      args: ["plan", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.kind?.type).toBe("manual-install");
  });

  it("--json up-to-date → message indicating no update", async () => {
    env = await createTestEnvironment({
      channel: "native",
      currentVersion: "2.0.0",
    });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest, // tag_name: v2.0.0
      },
    ]);

    const result = await runCLI({
      args: ["plan", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.message).toMatch(/no update/i);
  });

  it("text output (no --json) → human-readable plan description", async () => {
    env = await createTestEnvironment({
      channel: "npm-global",
      currentVersion: "1.0.0",
    });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest,
      },
      {
        url: "registry\\.npmjs\\.org/.*/latest",
        body: { version: "2.0.0" },
      },
    ]);

    const result = await runCLI({
      args: ["plan", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    // Text output should contain human-readable plan info
    expect(result.stdout).toMatch(/Plan:|No update/i);
  });
});
