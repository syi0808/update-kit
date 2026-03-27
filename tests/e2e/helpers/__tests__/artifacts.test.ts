import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestArtifacts } from "../artifacts.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

describe("createTestArtifacts", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-artifacts-"));
    await createTestArtifacts(tmpDir);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates tar.gz artifact", async () => {
    const tarPath = path.join(tmpDir, "test-app-v2.0.0-darwin-arm64.tar.gz");
    const stat = await fs.stat(tarPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("creates zip artifact", async () => {
    const zipPath = path.join(tmpDir, "test-app-v2.0.0-linux-x64.zip");
    const stat = await fs.stat(zipPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("creates bare binary", async () => {
    const barePath = path.join(tmpDir, "test-app-v2.0.0-bare");
    const content = await fs.readFile(barePath, "utf-8");
    expect(content).toContain("test-app v2.0.0");
  });

  it("creates SHA256SUMS with correct hashes", async () => {
    const sums = await fs.readFile(path.join(tmpDir, "SHA256SUMS"), "utf-8");
    const lines = sums.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Verify one hash
    const [hash, filename] = lines[0].split(/\s+/);
    const fileContent = await fs.readFile(path.join(tmpDir, filename));
    const computed = createHash("sha256").update(fileContent).digest("hex");
    expect(hash).toBe(computed);
  });

  it("tar.gz can be extracted and contains executable", async () => {
    const extractDir = path.join(tmpDir, "extract-test");
    await fs.mkdir(extractDir, { recursive: true });
    execSync(`tar xzf "${path.join(tmpDir, "test-app-v2.0.0-darwin-arm64.tar.gz")}" -C "${extractDir}"`);

    const files = await fs.readdir(extractDir);
    expect(files.length).toBeGreaterThan(0);

    const binary = path.join(extractDir, files[0]);
    const content = await fs.readFile(binary, "utf-8");
    expect(content).toContain("test-app v2.0.0");
  });
});
