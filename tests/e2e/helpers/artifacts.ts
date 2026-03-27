import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const BINARY_CONTENT = '#!/bin/sh\necho "test-app v2.0.0"\n';

export async function createTestArtifacts(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });

  // 1. Bare binary
  const barePath = path.join(dir, "test-app-v2.0.0-bare");
  await fs.writeFile(barePath, BINARY_CONTENT, { mode: 0o755 });

  // 2. tar.gz
  const tarStagingDir = path.join(dir, "_tar_staging");
  await fs.mkdir(tarStagingDir, { recursive: true });
  await fs.writeFile(path.join(tarStagingDir, "test-app"), BINARY_CONTENT, { mode: 0o755 });

  const tarName = "test-app-v2.0.0-darwin-arm64.tar.gz";
  execSync(`tar czf "${path.join(dir, tarName)}" -C "${tarStagingDir}" test-app`);
  await fs.rm(tarStagingDir, { recursive: true, force: true });

  // 3. zip
  const zipStagingDir = path.join(dir, "_zip_staging");
  await fs.mkdir(zipStagingDir, { recursive: true });
  await fs.writeFile(path.join(zipStagingDir, "test-app"), BINARY_CONTENT, { mode: 0o755 });

  const zipName = "test-app-v2.0.0-linux-x64.zip";
  execSync(`cd "${zipStagingDir}" && zip -q "${path.join(dir, zipName)}" test-app`);
  await fs.rm(zipStagingDir, { recursive: true, force: true });

  // 4. SHA256SUMS
  const artifactNames = [tarName, zipName, "test-app-v2.0.0-bare"];
  const lines: string[] = [];
  for (const name of artifactNames) {
    const content = await fs.readFile(path.join(dir, name));
    const hash = createHash("sha256").update(content).digest("hex");
    lines.push(`${hash}  ${name}`);
  }
  await fs.writeFile(path.join(dir, "SHA256SUMS"), lines.join("\n") + "\n");
}
