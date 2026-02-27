import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { UpdatePlan, ApplyProgress, ApplyResult } from '../types.js';
import type { ApplyOptions } from './types.js';
import {
  UpdateKitError,
  INSECURE_URL,
  DOWNLOAD_FAILED,
  EXTRACT_FAILED,
  APPLY_FAILED,
  NETWORK_ERROR,
} from '../errors.js';
import { verifyChecksum } from './verify.js';
import { atomicReplace } from '../platform/replace.js';
import { fetchWithTimeout } from '../utils/http.js';
import { DEFAULT_DOWNLOAD_TIMEOUT_MS } from '../constants.js';

const execFileAsync = promisify(execFile);

/**
 * Apply a native-in-place update: download, verify, extract, replace.
 *
 * @param plan - Update plan with kind.type === 'native-in-place'.
 * @param targetPath - Absolute path to the binary being replaced.
 * @param options - Progress callback, AbortSignal, skipChecksum.
 */
export async function applyNativeUpdate(
  plan: UpdatePlan,
  targetPath: string,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  if (plan.kind.type !== 'native-in-place') {
    throw new UpdateKitError(
      APPLY_FAILED,
      `applyNativeUpdate requires a native-in-place plan, got: ${plan.kind.type}`,
    );
  }

  const { downloadUrl, checksumUrl, expectedChecksum } = plan.kind;
  const { onProgress, signal, skipChecksum = false } = options;

  const tmpDir = await createTempDir(targetPath);

  try {
    // Phase 1: Download
    const downloadedPath = await downloadArtifact(downloadUrl, tmpDir, {
      onProgress,
      signal,
    });

    // Phase 2: Verify checksum
    if (!skipChecksum) {
      onProgress?.({ phase: 'verifying' });
      const filename = extractFilename(downloadUrl);
      await verifyChecksum(
        downloadedPath,
        { checksumUrl, expectedChecksum },
        { filename, signal },
      );
    }

    // Phase 3: Extract
    onProgress?.({ phase: 'extracting' });
    const binaryPath = await extractBinary(downloadedPath, tmpDir);

    // Phase 4: Set executable permission (Unix only)
    if (process.platform !== 'win32') {
      await setExecutablePermission(binaryPath);
    }

    // Phase 5: Atomic replace
    onProgress?.({ phase: 'replacing' });
    await atomicReplace(binaryPath, targetPath);

    // Phase 6: Done
    onProgress?.({ phase: 'done' });

    return {
      kind: 'success',
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      postAction: plan.postAction,
    };
  } catch (error) {
    // Original binary is intact because atomicReplace is designed to be safe:
    // either the rename succeeds (atomic) or the original is untouched.
    const rollbackSucceeded = true;

    if (error instanceof UpdateKitError) {
      return { kind: 'failed', error, rollbackSucceeded };
    }

    return {
      kind: 'failed',
      error: error instanceof Error ? error : new Error(String(error)),
      rollbackSucceeded,
    };
  } finally {
    await cleanupTempDir(tmpDir);
  }
}

/**
 * Streaming HTTPS download with progress reporting.
 */
export async function downloadArtifact(
  url: string,
  tmpDir: string,
  options: { onProgress?: (p: ApplyProgress) => void; signal?: AbortSignal },
): Promise<string> {
  if (!url.startsWith('https://')) {
    throw new UpdateKitError(INSECURE_URL, 'HTTPS is required.');
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { signal: options.signal, timeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new UpdateKitError(NETWORK_ERROR, 'Download request failed.', {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (!response.ok) {
    throw new UpdateKitError(
      DOWNLOAD_FAILED,
      `Download failed: HTTP ${response.status}`,
    );
  }

  if (!response.body) {
    throw new UpdateKitError(DOWNLOAD_FAILED, 'Response body is empty.');
  }

  const totalBytes = Number(response.headers.get('content-length')) || undefined;
  const filename = extractFilename(url);
  const destPath = path.join(tmpDir, filename);

  let bytesDownloaded = 0;
  // Readable.fromWeb types differ between Node and DOM; explicit cast bridges the gap
  const nodeStream = Readable.fromWeb(
    response.body as import('node:stream/web').ReadableStream,
  );
  const writeStream = createWriteStream(destPath);

  nodeStream.on('data', (chunk: Buffer) => {
    bytesDownloaded += chunk.length;
    options.onProgress?.({
      phase: 'downloading',
      bytesDownloaded,
      totalBytes,
    });
  });

  await pipeline(nodeStream, writeStream);

  return destPath;
}

/**
 * Extract a binary from an archive file.
 * Supports .tar.gz/.tgz, .zip, and bare binaries.
 */
export async function extractBinary(
  archivePath: string,
  tmpDir: string,
): Promise<string> {
  const extractDir = path.join(tmpDir, 'extracted');
  await fs.mkdir(extractDir, { recursive: true });

  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    try {
      await execFileAsync('tar', ['xzf', archivePath, '-C', extractDir]);
    } catch (error) {
      throw new UpdateKitError(EXTRACT_FAILED, 'Failed to extract tar.gz archive.', {
        cause: error instanceof Error ? error : undefined,
      });
    }
  } else if (archivePath.endsWith('.zip')) {
    try {
      if (process.platform !== 'win32') {
        await execFileAsync('unzip', ['-o', archivePath, '-d', extractDir]);
      } else {
        await execFileAsync('powershell', [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`,
        ]);
      }
    } catch (error) {
      throw new UpdateKitError(EXTRACT_FAILED, 'Failed to extract zip archive.', {
        cause: error instanceof Error ? error : undefined,
      });
    }
  } else {
    // Bare binary — just copy it
    const destPath = path.join(extractDir, path.basename(archivePath));
    await fs.copyFile(archivePath, destPath);
    return destPath;
  }

  return findBinaryInDir(extractDir);
}

/**
 * Find the executable binary inside an extracted directory.
 * Single file → return it. Multiple files → prefer the one with execute permission.
 */
export async function findBinaryInDir(dir: string): Promise<string> {
  const resolvedDir = await fs.realpath(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  const files: string[] = [];

  for (const e of entries) {
    if (!e.isFile()) continue;

    // parentPath was added in Node 20.12; fall back to the legacy 'path' property
    const parentDir =
      e.parentPath ?? (e as unknown as { path?: string }).path ?? dir;
    const filePath = path.join(parentDir, e.name);

    // Ensure the resolved path is within the extraction directory
    // to prevent symlink escape attacks
    try {
      const resolvedFile = await fs.realpath(filePath);
      if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
        continue;
      }
    } catch {
      continue;
    }

    files.push(filePath);
  }

  if (files.length === 0) {
    throw new UpdateKitError(EXTRACT_FAILED, 'No binary found in extracted archive.');
  }

  if (files.length === 1) {
    return files[0];
  }

  // Prefer the file with execute permission
  for (const file of files) {
    try {
      await fs.access(file, fs.constants.X_OK);
      return file;
    } catch {
      continue;
    }
  }

  return files[0];
}

/** Extract the filename from a URL pathname. */
export function extractFilename(url: string): string {
  const urlObj = new URL(url);
  const segments = urlObj.pathname.split('/');
  return segments[segments.length - 1] || 'artifact';
}

/** Create a temp directory on the same filesystem as the target. */
export async function createTempDir(targetPath: string): Promise<string> {
  const targetDir = path.dirname(targetPath);
  const tmpDir = path.join(
    targetDir,
    `.update-kit-tmp-${process.pid}-${Date.now()}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

/** Clean up a temp directory. Non-fatal on failure. */
export async function cleanupTempDir(tmpDir: string): Promise<void> {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Cleanup failure is non-fatal
  }
}

async function setExecutablePermission(filePath: string): Promise<void> {
  await fs.chmod(filePath, 0o755);
}
