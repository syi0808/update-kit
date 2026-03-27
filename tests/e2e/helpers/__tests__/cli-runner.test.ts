import { describe, it, expect, afterEach } from "vitest";
import { runCLI } from "../cli-runner.js";
import { createTestEnvironment, type TestEnvironment } from "../environment.js";
import path from "node:path";
import fs from "node:fs/promises";

describe("runCLI", () => {
  let env: TestEnvironment | undefined;

  afterEach(async () => {
    await env?.cleanup();
  });

  it("runs --help and exits 0", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const result = await runCLI({
      args: ["--help"],
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/usage|update-kit/i);
  });

  it("runs detect --json with native environment", async () => {
    env = await createTestEnvironment({ channel: "native" });

    const routesDir = path.join(env.tmpDir, "fetch-routes");
    await fs.mkdir(routesDir, { recursive: true });
    await fs.writeFile(path.join(routesDir, "routes.json"), JSON.stringify([]));

    const result = await runCLI({
      args: ["detect", "--json", "--config", env.configPath],
      env,
      fetchMockDir: routesDir,
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.channel).toBe("native");
  });
});
