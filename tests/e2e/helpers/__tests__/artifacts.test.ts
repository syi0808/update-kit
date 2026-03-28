import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BARE_NAME,
  createTestArtifacts,
  TAR_NAME,
  ZIP_NAME,
} from "../artifacts.js";

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
    const tarPath = path.join(tmpDir, TAR_NAME);
    const stat = await fs.stat(tarPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === "win32")("creates zip artifact", async () => {
    const zipPath = path.join(tmpDir, ZIP_NAME);
    const stat = await fs.stat(zipPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("creates bare binary", async () => {
    const barePath = path.join(tmpDir, BARE_NAME);
    const content = await fs.readFile(barePath, "utf-8");
    expect(content).toContain("test-app v2.0.0");
  });

  it("creates SHA256SUMS with correct hashes", async () => {
    const sums = await fs.readFile(path.join(tmpDir, "SHA256SUMS"), "utf-8");
    const lines = sums.trim().split("\n");
    const expectedCount = process.platform === "win32" ? 2 : 3;
    expect(lines.length).toBeGreaterThanOrEqual(expectedCount);

    // Verify one hash
    const [hash, filename] = lines[0].split(/\s+/);
    const fileContent = await fs.readFile(path.join(tmpDir, filename));
    const computed = createHash("sha256").update(fileContent).digest("hex");
    expect(hash).toBe(computed);
  });

  it("tar.gz can be extracted and contains executable", async () => {
    const extractDir = path.join(tmpDir, "extract-test");
    await fs.mkdir(extractDir, { recursive: true });
    execSync(`tar xzf "${path.join(tmpDir, TAR_NAME)}" -C "${extractDir}"`);

    const files = await fs.readdir(extractDir);
    expect(files.length).toBeGreaterThan(0);

    const binary = path.join(extractDir, files[0]);
    const content = await fs.readFile(binary, "utf-8");
    expect(content).toContain("test-app v2.0.0");
  });
});
