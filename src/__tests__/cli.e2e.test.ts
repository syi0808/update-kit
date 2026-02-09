import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("CLI E2E", () => {
  let tmpDir: string;
  let configPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "update-kit-cli-"));
    configPath = join(tmpDir, "update-kit.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        appName: "test-app",
        currentVersion: "1.0.0",
        sources: [],
      }),
    );
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCli(...args: string[]): string {
    return execFileSync(
      "node",
      ["dist/cli.mjs", ...args, "--config", configPath],
      { encoding: "utf-8", timeout: 10_000 },
    );
  }

  it("prints help when invoked with no arguments", () => {
    const output = execFileSync("node", ["dist/cli.mjs"], {
      encoding: "utf-8",
    });
    expect(output).toContain("Usage:");
    expect(output).toContain("Commands:");
  });

  it("prints help with --help flag", () => {
    const output = execFileSync("node", ["dist/cli.mjs", "--help"], {
      encoding: "utf-8",
    });
    expect(output).toContain("Usage:");
  });

  it("detect command outputs JSON", () => {
    const output = runCli("detect", "--json");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("channel");
    expect(parsed).toHaveProperty("confidence");
  });

  it("check command works", () => {
    const output = runCli("check");
    expect(output).toBeTruthy();
  });

  it("cache show command works", () => {
    const output = runCli("cache", "show");
    expect(output).toBeTruthy();
  });

  it("cache clear command works", () => {
    const output = runCli("cache", "clear");
    expect(output.toLowerCase()).toContain("clear");
  });
});
