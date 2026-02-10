import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Result of finding and parsing a package.json file.
 */
export interface PackageJsonResult {
  /** Package name from the "name" field */
  name: string;
  /** Package version from the "version" field */
  version: string;
  /** Absolute path to the found package.json */
  path: string;
}

/**
 * Walk up the directory tree from `startDir` to find the nearest package.json
 * that contains both `name` and `version` fields.
 *
 * @param startDir - Directory to start searching from (required).
 * @returns Parsed package info, or `null` if no valid package.json is found.
 */
export async function findPackageJson(
  startDir: string,
): Promise<PackageJsonResult | null> {
  let current = resolve(startDir);

  for (;;) {
    const candidate = join(current, 'package.json');
    try {
      const content = await readFile(candidate, 'utf-8');
      const result = parsePackageJson(content, candidate);
      if (result) return result;
    } catch {
      // File doesn't exist or is unreadable; continue walking up
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Synchronous version of `findPackageJson`.
 *
 * @param startDir - Directory to start searching from (required).
 * @returns Parsed package info, or `null` if no valid package.json is found.
 */
export function findPackageJsonSync(
  startDir: string,
): PackageJsonResult | null {
  let current = resolve(startDir);

  for (;;) {
    const candidate = join(current, 'package.json');
    try {
      const content = readFileSync(candidate, 'utf-8');
      const result = parsePackageJson(content, candidate);
      if (result) return result;
    } catch {
      // File doesn't exist or is unreadable; continue walking up
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Find the nearest package.json relative to the calling module's location.
 * This is the correct way for an ESM module to find its own package.json.
 *
 * @param importMetaUrl - The `import.meta.url` of the calling module.
 * @returns Parsed package info, or `null` if no valid package.json is found.
 *
 * @example
 * ```typescript
 * import { findPackageJsonFromModule } from 'update-kit';
 * const pkg = await findPackageJsonFromModule(import.meta.url);
 * ```
 */
export async function findPackageJsonFromModule(
  importMetaUrl: string,
): Promise<PackageJsonResult | null> {
  const moduleDir = dirname(fileURLToPath(importMetaUrl));
  return findPackageJson(moduleDir);
}

/**
 * Synchronous version of `findPackageJsonFromModule`.
 *
 * @param importMetaUrl - The `import.meta.url` of the calling module.
 * @returns Parsed package info, or `null` if no valid package.json is found.
 */
export function findPackageJsonFromModuleSync(
  importMetaUrl: string,
): PackageJsonResult | null {
  const moduleDir = dirname(fileURLToPath(importMetaUrl));
  return findPackageJsonSync(moduleDir);
}

/**
 * Get the file path of the external caller using V8 CallSite API.
 * Walks up the stack to find the first frame outside update-kit's own source.
 *
 * @returns A file URL (ESM) or absolute path (CJS), or `null` if not found.
 * @internal
 */
export function getCallerFilePath(): string | null {
  const origPrepare = Error.prepareStackTrace;
  try {
    let callSites: NodeJS.CallSite[] = [];
    Error.prepareStackTrace = (_, stack) => {
      callSites = stack;
      return '';
    };
    const err = new Error();
    // Access .stack to trigger prepareStackTrace
    err.stack;

    // Skip frame 0 (this function) and frame 1 (the direct caller inside update-kit).
    // Return the first frame whose filename exists.
    for (let i = 2; i < callSites.length; i++) {
      const fileName = callSites[i]?.getFileName();
      if (fileName) return fileName;
    }
    return null;
  } finally {
    Error.prepareStackTrace = origPrepare;
  }
}

/**
 * Resolve the nearest package.json from a caller file path.
 * Handles both ESM `file://` URLs and CJS absolute paths.
 *
 * @param callerFile - File URL or absolute path of the caller module.
 * @returns Parsed package info, or `null` if not found.
 * @internal
 */
export async function resolvePackageJsonFromCaller(
  callerFile: string,
): Promise<PackageJsonResult | null> {
  const filePath = callerFile.startsWith('file://')
    ? fileURLToPath(callerFile)
    : callerFile;
  return findPackageJson(dirname(filePath));
}

function parsePackageJson(
  content: string,
  filePath: string,
): PackageJsonResult | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'name' in parsed &&
      'version' in parsed &&
      typeof (parsed as Record<string, unknown>).name === 'string' &&
      (parsed as Record<string, unknown>).name !== '' &&
      typeof (parsed as Record<string, unknown>).version === 'string' &&
      (parsed as Record<string, unknown>).version !== ''
    ) {
      const obj = parsed as Record<string, unknown>;
      return {
        name: obj.name as string,
        version: obj.version as string,
        path: filePath,
      };
    }
    return null;
  } catch {
    return null;
  }
}
