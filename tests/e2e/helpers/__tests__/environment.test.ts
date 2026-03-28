import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEnvironment, type TestEnvironment } from "../environment.js";

describe("createTestEnvironment", () => {
  let env: TestEnvironment | undefined;

  afterEach(async () => {
    await env?.cleanup();
  });

  it("creates native environment with install receipt", async () => {
    env = await createTestEnvironment({ channel: "native" });

    // Check receipt exists
    const receiptPath = path.join(
      env.tmpDir,
      ".config",
      "test-app",
      "install-receipt.json",
    );
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf-8"));
    expect(receipt.appName).toBe("test-app");
    expect(receipt.channel).toBe("native");

    // Check executable exists
    const stat = await fs.stat(env.executablePath);
    expect(stat.isFile()).toBe(true);

    // Check config exists
    const config = JSON.parse(await fs.readFile(env.configPath, "utf-8"));
    expect(config.appName).toBe("test-app");
    expect(config.currentVersion).toBe("1.0.0");
  });

  it("creates npm-global environment with node_modules path structure", async () => {
    env = await createTestEnvironment({ channel: "npm-global" });

    expect(env.executablePath).toContain("node_modules/.bin/");
    const stat = await fs.lstat(env.executablePath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it("creates brew-cask environment with /opt/homebrew/ path", async () => {
    env = await createTestEnvironment({ channel: "brew-cask" });

    expect(env.executablePath).toContain("opt/homebrew/");
    // Check mock brew exists in binDir
    const brewPath = path.join(env.binDir, "brew");
    const stat = await fs.stat(brewPath);
    expect(stat.isFile()).toBe(true);
  });

  it("creates unmanaged environment with generic path", async () => {
    env = await createTestEnvironment({ channel: "unmanaged" });

    expect(env.executablePath).not.toContain("node_modules");
    expect(env.executablePath).not.toContain("homebrew");
  });

  it("respects currentVersion override", async () => {
    env = await createTestEnvironment({
      channel: "native",
      currentVersion: "3.5.0",
    });

    const config = JSON.parse(await fs.readFile(env.configPath, "utf-8"));
    expect(config.currentVersion).toBe("3.5.0");
  });

  it("provides PATH with binDir first", async () => {
    env = await createTestEnvironment({ channel: "npm-global" });

    expect(env.env.PATH).toMatch(
      new RegExp(`^${env.binDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  });

  it("cleanup removes tmpDir", async () => {
    env = await createTestEnvironment({ channel: "native" });
    const tmpDir = env.tmpDir;
    await env.cleanup();
    await expect(fs.stat(tmpDir)).rejects.toThrow();
    env = undefined; // prevent double cleanup
  });
});
