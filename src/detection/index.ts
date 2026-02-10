import type { InstallDetection } from '../types.js';
import type { ResolvedUpdateKitConfig } from '../config.js';
import { realpath } from 'node:fs/promises';
import { detectFromReceipt } from './receipt.js';
import { detectFromBrew } from './brew.js';
import { detectFromNpm } from './npm.js';
import { collectPathHeuristics } from './heuristics.js';

/**
 * Detect the installation channel of the running CLI app.
 *
 * Detection priority:
 * 1. Install receipt (explicit record) — highest priority
 * 2. Homebrew patterns (path + command verification)
 * 3. npm global patterns (path + prefix + symlink)
 * 4. Fallback: unmanaged
 *
 * @param execPath - Executable file path. Typically process.execPath.
 * @param config - App config (appName required)
 * @returns Detection result with channel, confidence, and evidence
 */
export async function detectInstall(
  execPath: string,
  config: Pick<ResolvedUpdateKitConfig, 'appName' | 'brewCaskName'>,
): Promise<InstallDetection> {
  // Resolve symlinks to get the real path
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(execPath);
  } catch {
    resolvedPath = execPath;
  }

  // 1. Install receipt check
  const receiptResult = await detectFromReceipt(config);
  if (receiptResult) {
    return receiptResult;
  }

  // 2. Homebrew check
  const brewResult = await detectFromBrew(resolvedPath, config);
  if (brewResult) {
    return brewResult;
  }

  // 3. npm global check
  const npmResult = await detectFromNpm(resolvedPath);
  if (npmResult) {
    return npmResult;
  }

  // 4. Fallback: unmanaged
  const heuristicEvidence = collectPathHeuristics(resolvedPath);
  return {
    channel: 'unmanaged',
    confidence: heuristicEvidence.length > 0 ? 'low' : 'none',
    evidence: [
      {
        source: 'fallback',
        detail: 'No known install channel pattern matched',
      },
      ...heuristicEvidence,
    ],
  };
}

export { detectFromReceipt } from './receipt.js';
export { detectFromBrew } from './brew.js';
export { detectFromNpm } from './npm.js';
export { collectPathHeuristics } from './heuristics.js';
