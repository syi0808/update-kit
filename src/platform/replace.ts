import fs from "node:fs/promises";
import { APPLY_FAILED, PERMISSION_DENIED, UpdateKitError } from "../errors.js";

/**
 * Atomically replace the target binary with a new file.
 *
 * Unix: copy to same-dir temp file, then fs.rename (atomic on same filesystem).
 * Windows: rename target to .old, copy new to target, clean up .old. Rollback on failure.
 *
 * @throws UpdateKitError with PERMISSION_DENIED if target is not writable.
 */
export async function atomicReplace(
  newPath: string,
  targetPath: string,
): Promise<void> {
  try {
    await fs.access(targetPath, fs.constants.W_OK);
  } catch {
    throw new UpdateKitError(
      PERMISSION_DENIED,
      `No write permission: ${targetPath}. Run with appropriate permissions.`,
    );
  }

  if (process.platform === "win32") {
    await windowsReplace(newPath, targetPath);
  } else {
    await unixReplace(newPath, targetPath);
  }
}

async function unixReplace(newPath: string, targetPath: string): Promise<void> {
  const tmpInPlace = `${targetPath}.new.${process.pid}`;

  try {
    await fs.copyFile(newPath, tmpInPlace);
    await fs.chmod(tmpInPlace, 0o755);
    await fs.rename(tmpInPlace, targetPath);
  } catch (error) {
    // Attempt cleanup of temp file
    try {
      await fs.unlink(tmpInPlace);
    } catch {
      // Ignore cleanup failure
    }
    throw error;
  }
}

async function windowsReplace(
  newPath: string,
  targetPath: string,
): Promise<void> {
  const backupPath = `${targetPath}.old`;

  // Clean up previous backup
  try {
    await fs.unlink(backupPath);
  } catch {
    // Ignore
  }

  // Move current exe to .old
  await fs.rename(targetPath, backupPath);

  try {
    // Copy new file to target location
    await fs.copyFile(newPath, targetPath);
  } catch (copyError) {
    // Rollback: restore from .old
    try {
      await fs.rename(backupPath, targetPath);
    } catch (rollbackError) {
      throw new UpdateKitError(
        APPLY_FAILED,
        `Update failed and rollback also failed. Original binary may be at ${backupPath}. ` +
          `Copy error: ${copyError instanceof Error ? copyError.message : String(copyError)}. ` +
          `Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}.`,
      );
    }
    throw copyError;
  }

  // Clean up .old (may fail if the file is still in use on Windows)
  try {
    await fs.unlink(backupPath);
  } catch {
    // Will be cleaned up on next update
  }
}
