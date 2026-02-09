import type { InstallDetection, Evidence } from '../types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readlink } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

/** npm global install path patterns */
const NPM_PATH_PATTERNS = [
  'node_modules/.bin/',
  '/lib/node_modules/',
];

/**
 * Detect install channel from npm global install indicators.
 * Checks path patterns, npm global prefix, and symlink targets.
 * Confidence is based on the number of matching evidence items.
 */
export async function detectFromNpm(
  execPath: string,
): Promise<InstallDetection | null> {
  const evidence: Evidence[] = [];

  // 1. Path pattern matching
  const matchedPattern = NPM_PATH_PATTERNS.find((pattern) =>
    execPath.includes(pattern),
  );

  if (matchedPattern) {
    evidence.push({
      source: 'path_pattern',
      detail: `Exec path matches npm pattern: ${matchedPattern}`,
    });
  }

  // 2. npm prefix -g comparison
  try {
    const { stdout } = await execFileAsync('npm', ['prefix', '-g']);
    const globalPrefix = stdout.trim();
    if (execPath.startsWith(globalPrefix)) {
      evidence.push({
        source: 'npm_prefix',
        detail: `Exec path is under npm global prefix: ${globalPrefix}`,
      });
    }
  } catch {
    // npm command failed — ignore
  }

  // 3. Symlink check (npm link installs)
  try {
    const stats = await lstat(execPath);
    if (stats.isSymbolicLink()) {
      const target = await readlink(execPath);
      if (target.includes('node_modules')) {
        evidence.push({
          source: 'symlink',
          detail: `Symlink target includes node_modules: ${target}`,
        });
      }
    }
  } catch {
    // Symlink check failed — ignore
  }

  if (evidence.length === 0) {
    return null;
  }

  const confidence = evidence.length >= 2 ? 'high' : 'medium';

  return {
    channel: 'npm-global',
    confidence,
    evidence,
  };
}
