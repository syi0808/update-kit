// tests/e2e/cli/errors.e2e.test.ts

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

describe("CLI: error handling", () => {
  let env: TestEnvironment | undefined;

  afterEach(async () => {
    await env?.cleanup();
  });

  it("unknown subcommand → usage output + exit 1", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const result = await runCLI({
      args: ["totally-unknown-command"],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/usage|update-kit/i);
  });

  it("--help → usage output + exit 0", async () => {
    env = await createTestEnvironment({ channel: "native" });

    const result = await runCLI({
      args: ["--help"],
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/usage|update-kit/i);
    expect(result.stdout).toMatch(/detect|check|plan|apply/i);
  });

  it("invalid JSON config → parse error + non-zero exit", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    const badConfigPath = path.join(env.tmpDir, "invalid.json");
    await fs.writeFile(badConfigPath, "{ this is not valid JSON !!!");

    const result = await runCLI({
      args: ["detect", "--config", badConfigPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/invalid json|parse|SyntaxError/i);
  });

  it("missing required config fields → validation error + non-zero exit", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const routesDir = path.join(env.tmpDir, "routes");
    await writeFetchRoutes(routesDir, []);

    // Config is valid JSON but missing required appName
    const incompleteConfigPath = path.join(env.tmpDir, "incomplete.json");
    await fs.writeFile(
      incompleteConfigPath,
      JSON.stringify({ currentVersion: "1.0.0" /* missing appName */ }),
    );

    const result = await runCLI({
      args: ["detect", "--config", incompleteConfigPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/appName|required field/i);
  });
});
