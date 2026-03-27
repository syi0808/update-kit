// tests/e2e/cli/doctor.e2e.test.ts
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

describe("CLI: doctor", () => {
  let env: TestEnvironment | undefined;

  afterEach(async () => {
    await env?.cleanup();
  });

  it("doctor with valid config → all checks pass, exit 0", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest,
      },
    ]);

    const result = await runCLI({
      args: ["doctor", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    // Config file check should pass
    expect(result.stdout).toMatch(/PASS|pass/);
  });

  it("doctor with missing required config fields → problem identified", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });

    // Write an invalid config missing appName
    const badConfigPath = path.join(env.tmpDir, "bad-config.json");
    await fs.writeFile(
      badConfigPath,
      JSON.stringify({ currentVersion: "1.0.0" /* missing appName */ }),
    );

    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["doctor", "--config", badConfigPath],
      env,
      fetchMockDir: routesDir,
    });

    // Doctor should exit 1 with failed checks
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toMatch(/FAIL|fail|missing|appName/i);
  });

  it("doctor with source connectivity failure → failure shown", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    // Return 404 so source connectivity fails
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: { message: "Not Found" },
        status: 404,
      },
    ]);

    const result = await runCLI({
      args: ["doctor", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    // Doctor exits 1 when connectivity check fails
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toMatch(/FAIL|fail/i);
  });

  it("doctor --json → structured JSON output with checks and summary", async () => {
    env = await createTestEnvironment({ channel: "native", currentVersion: "1.0.0" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, [
      {
        url: "api\\.github\\.com/repos/.*/releases/latest",
        body: githubLatest,
      },
    ]);

    const result = await runCLI({
      args: ["doctor", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    // JSON mode: parse output regardless of exit code
    const json = JSON.parse(result.stdout);
    expect(Array.isArray(json.checks)).toBe(true);
    expect(json.summary).toBeDefined();
    expect(typeof json.summary.total).toBe("number");
    expect(typeof json.summary.passed).toBe("number");
    expect(typeof json.summary.failed).toBe("number");
  });
});
