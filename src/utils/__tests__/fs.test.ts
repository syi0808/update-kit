import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicWriteFile } from "../fs.js";

describe("atomicWriteFile", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-kit-test-"));
    return tmpDir;
  }

  it("writes content correctly", async () => {
    const dir = await setup();
    const filePath = path.join(dir, "test.json");

    await atomicWriteFile(filePath, '{"key":"value"}');

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe('{"key":"value"}');
  });

  it("overwrites existing file", async () => {
    const dir = await setup();
    const filePath = path.join(dir, "test.json");

    await fs.writeFile(filePath, "old content");
    await atomicWriteFile(filePath, "new content");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("new content");
  });

  it("leaves no temp files on success", async () => {
    const dir = await setup();
    const filePath = path.join(dir, "test.json");

    await atomicWriteFile(filePath, "data");

    const files = await fs.readdir(dir);
    expect(files).toEqual(["test.json"]);
  });

  it("sets restrictive permissions on non-Windows", async () => {
    if (process.platform === "win32") return;

    const dir = await setup();
    const filePath = path.join(dir, "test.json");

    await atomicWriteFile(filePath, "secret");

    const stat = await fs.stat(filePath);
    // 0o600 = owner read+write only
    expect(stat.mode & 0o777).toBe(0o600);
  });

});
