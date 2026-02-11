import type { VersionSourceConfig, ResolvedUpdateKitConfig } from '../config.js';
import type { Channel } from '../types.js';

/**
 * Parse a GitHub repository field into owner/repo.
 *
 * Supported formats:
 * - "https://github.com/owner/repo"
 * - "https://github.com/owner/repo.git"
 * - "git+https://github.com/owner/repo.git"
 * - "git://github.com/owner/repo.git"
 * - "github:owner/repo"
 * - { url: "https://github.com/owner/repo.git" }
 *
 * Returns `null` for non-GitHub URLs or unrecognized formats.
 */
export function parseGitHubRepository(
  repository: string | { url?: string } | undefined | null,
): { owner: string; repo: string } | null {
  if (!repository) return null;

  const url = typeof repository === 'string' ? repository : repository.url;
  if (!url) return null;

  // Handle "github:owner/repo" shorthand
  const shorthandMatch = url.match(/^github:([^/]+)\/([^/]+)$/);
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2] };
  }

  // Handle full GitHub URLs (https, git+https, git://, ssh)
  const urlMatch = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  return null;
}

/** Channel-based source type priority */
const CHANNEL_PRIORITY: Record<string, string[]> = {
  'npm-global': ['npm', 'github', 'brew'],
  'brew-cask': ['brew', 'github', 'npm'],
  native: ['github', 'npm', 'brew'],
  unmanaged: ['github', 'npm', 'brew'],
};

const DEFAULT_PRIORITY = ['npm', 'github', 'brew'];

/**
 * Infer version source configs from the resolved config.
 * Called when user did not provide explicit sources.
 *
 * - npm: always inferable (uses npmPackageName or appName)
 * - github: only if repository resolves to GitHub owner/repo
 * - brew: only if brewCaskName is explicitly set
 */
export function inferSourceConfigs(
  config: ResolvedUpdateKitConfig,
): VersionSourceConfig[] {
  const sources: VersionSourceConfig[] = [];

  // npm source — always available since appName is required
  sources.push({
    type: 'npm',
    packageName: config.npmPackageName ?? config.appName,
  });

  // github source — only if repository info is available
  const github = parseGitHubRepository(config.repository);
  if (github) {
    sources.push({
      type: 'github',
      owner: github.owner,
      repo: github.repo,
    });
  }

  // brew source — only if brewCaskName is explicitly set
  if (config.brewCaskName) {
    sources.push({
      type: 'brew',
      caskName: config.brewCaskName,
    });
  }

  return sources;
}

/**
 * Reorder source configs based on the detected install channel.
 * Sources matching the channel's preferred type are moved to the front.
 */
export function orderSourcesByChannel(
  sources: VersionSourceConfig[],
  channel: Channel,
): VersionSourceConfig[] {
  const priority = CHANNEL_PRIORITY[channel] ?? DEFAULT_PRIORITY;
  return [...sources].sort((a, b) => {
    const ai = priority.indexOf(a.type);
    const bi = priority.indexOf(b.type);
    // Unknown types go to the end
    const pa = ai === -1 ? priority.length : ai;
    const pb = bi === -1 ? priority.length : bi;
    return pa - pb;
  });
}
