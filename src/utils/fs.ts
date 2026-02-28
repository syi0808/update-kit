import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Write a file atomically.
 * Writes to a unique temp file first, then renames to the target path.
 * Prevents partial writes and concurrent access corruption.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
): Promise<void> {
  const dir = dirname(filePath);
  const tmpName = `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`;
  const tmpPath = join(dir, tmpName);

  try {
    await writeFile(tmpPath, data, { mode: 0o600 });
    await rename(tmpPath, filePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // Cleanup failure is non-fatal
    }
    throw err;
  }
}
