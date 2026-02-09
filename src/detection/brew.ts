import type { InstallDetection, Evidence } from '../types.js';
import type { UpdateKitConfig } from '../config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Homebrew-related path patterns */
const BREW_PATH_PATTERNS = [
  '/opt/homebrew/',
  '/usr/local/Caskroom/',
  '/usr/local/Cellar/',
  '/home/linuxbrew/',
];

/**
 * Detect install channel from Homebrew path patterns.
 * Returns 'brew-cask' with 'medium' confidence on path match,
 * upgraded to 'high' if `brew list --cask` confirms the package.
 */
export async function detectFromBrew(
  execPath: string,
  config: Pick<UpdateKitConfig, 'brewCaskName'>,
): Promise<InstallDetection | null> {
  const matchedPattern = BREW_PATH_PATTERNS.find((pattern) =>
    execPath.includes(pattern),
  );

  if (!matchedPattern) {
    return null;
  }

  const evidence: Evidence[] = [
    {
      source: 'path_pattern',
      detail: `Exec path matches Homebrew pattern: ${matchedPattern}`,
    },
  ];

  let confidence: 'medium' | 'high' = 'medium';

  if (config.brewCaskName) {
    try {
      await execFileAsync('brew', ['list', '--cask', config.brewCaskName]);
      confidence = 'high';
      evidence.push({
        source: 'brew_list',
        detail: `brew list --cask ${config.brewCaskName} confirmed`,
      });
    } catch {
      evidence.push({
        source: 'brew_list',
        detail: `brew list --cask verification failed, relying on path pattern only`,
      });
    }
  }

  return {
    channel: 'brew-cask',
    confidence,
    evidence,
  };
}
