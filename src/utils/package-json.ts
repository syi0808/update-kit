import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
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
  /** Raw repository field from package.json */
  repository?: string | { type?: string; url?: string };
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
 * Finds the update-kit package root from frame 0, then returns the first
 * frame whose file is outside that root.
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

    // Determine update-kit's package root from frame 0 (this function's own file)
    const ownFile = callSites[0]?.getFileName();
    if (!ownFile) return null;

    const ownPath = ownFile.startsWith('file://') ? fileURLToPath(ownFile) : ownFile;
    const ownPkg = findPackageJsonSync(dirname(ownPath));
    const ownRoot = ownPkg ? dirname(ownPkg.path) + sep : dirname(ownPath) + sep;

    // Return the first frame whose file is outside update-kit's package root
    for (let i = 1; i < callSites.length; i++) {
      const fileName = callSites[i]?.getFileName();
      if (!fileName) continue;

      const filePath = fileName.startsWith('file://') ? fileURLToPath(fileName) : fileName;
      if (!filePath.startsWith(ownRoot)) return fileName;
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
      const result: PackageJsonResult = {
        name: obj.name as string,
        version: obj.version as string,
        path: filePath,
      };

      if ('repository' in obj && obj.repository != null) {
        const repo = obj.repository;
        if (typeof repo === 'string') {
          result.repository = repo;
        } else if (typeof repo === 'object' && !Array.isArray(repo)) {
          const repoObj = repo as Record<string, unknown>;
          result.repository = {
            ...(typeof repoObj.type === 'string' ? { type: repoObj.type } : {}),
            ...(typeof repoObj.url === 'string' ? { url: repoObj.url } : {}),
          };
        }
      }

      return result;
    }
    return null;
  } catch {
    return null;
  }
}
