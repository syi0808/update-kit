// tests/e2e/cli/detect.e2e.test.ts

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

describe("CLI: detect", () => {
  let env: TestEnvironment | undefined;

  afterEach(async () => {
    await env?.cleanup();
  });

  it("text output shows channel and confidence", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["detect", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Channel:/);
    expect(result.stdout).toMatch(/Confidence:/);
  });

  it("--json with native channel returns channel=native", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["detect", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.channel).toBe("native");
    expect(json.confidence).toBeDefined();
  });

  it("--json with npm-global channel returns channel=npm-global", async () => {
    env = await createTestEnvironment({ channel: "npm-global" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["detect", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.channel).toBe("npm-global");
  });

  it("--json with brew-cask channel returns channel=brew-cask", async () => {
    env = await createTestEnvironment({ channel: "brew-cask" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["detect", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.channel).toBe("brew-cask");
  });

  it("--json with unmanaged channel returns channel=unmanaged", async () => {
    env = await createTestEnvironment({
      channel: "unmanaged",
      mockBinBehavior: { npm: { stdout: "/no/match/prefix" } },
    });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["detect", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.channel).toBe("unmanaged");
  });

  it("accepts custom --config path", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    // env.configPath is already a custom path; verify it works
    const result = await runCLI({
      args: ["detect", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.channel).toBeDefined();
  });

  it("missing config file exits with non-zero code and error message", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const missingPath = path.join(env.tmpDir, "does-not-exist.json");

    const result = await runCLI({
      args: ["detect", "--json", "--config", missingPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Config file not found|not found/i);
  });
});
