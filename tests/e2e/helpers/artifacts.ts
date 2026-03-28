import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const BINARY_CONTENT = '#!/bin/sh\necho "test-app v2.0.0"\n';

const platformName =
  process.platform === "win32" ? "windows" : process.platform;

export const PLATFORM_TAG = `${platformName}-${process.arch}`;
export const TAR_NAME = `test-app-v2.0.0-${PLATFORM_TAG}.tar.gz`;
export const ZIP_NAME = `test-app-v2.0.0-${PLATFORM_TAG}.zip`;
export const BARE_NAME = "test-app-v2.0.0-bare";

export async function createTestArtifacts(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });

  // 1. Bare binary
  const barePath = path.join(dir, BARE_NAME);
  await fs.writeFile(barePath, BINARY_CONTENT, { mode: 0o755 });

  // 2. tar.gz (platform-aware name)
  const tarStagingDir = path.join(dir, "_tar_staging");
  await fs.mkdir(tarStagingDir, { recursive: true });
  await fs.writeFile(path.join(tarStagingDir, "test-app"), BINARY_CONTENT, {
    mode: 0o755,
  });

  execSync(
    `tar czf "${path.join(dir, TAR_NAME)}" -C "${tarStagingDir}" test-app`,
  );
  await fs.rm(tarStagingDir, { recursive: true, force: true });

  // 3. zip (platform-aware name) — skip on Windows where zip CLI is unavailable
  if (process.platform !== "win32") {
    const zipStagingDir = path.join(dir, "_zip_staging");
    await fs.mkdir(zipStagingDir, { recursive: true });
    await fs.writeFile(path.join(zipStagingDir, "test-app"), BINARY_CONTENT, {
      mode: 0o755,
    });

    execSync(
      `cd "${zipStagingDir}" && zip -q "${path.join(dir, ZIP_NAME)}" test-app`,
    );
    await fs.rm(zipStagingDir, { recursive: true, force: true });
  }

  // 4. SHA256SUMS
  const artifactNames = [TAR_NAME];
  if (process.platform !== "win32") artifactNames.push(ZIP_NAME);
  artifactNames.push(BARE_NAME);

  const lines: string[] = [];
  for (const name of artifactNames) {
    const content = await fs.readFile(path.join(dir, name));
    const hash = createHash("sha256").update(content).digest("hex");
    lines.push(`${hash}  ${name}`);
  }
  await fs.writeFile(path.join(dir, "SHA256SUMS"), lines.join("\n") + "\n");
}
