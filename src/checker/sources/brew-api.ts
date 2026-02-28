import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';
import type { BrewSourceConfig } from '../../config.js';
import { fetchWithEtag } from './base.js';

export type { BrewSourceConfig } from '../../config.js';

export class BrewSource implements VersionSource {
  readonly name = 'brew';
  private readonly config: BrewSourceConfig;

  constructor(config: BrewSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const url = `https://formulae.brew.sh/api/cask/${this.config.caskName}.json`;

    const result = await fetchWithEtag({ url }, options);

    if (result.kind !== 'response') {
      if (result.kind === 'error' && result.status === 404) {
        return { kind: 'error', reason: `Homebrew cask not found: ${this.config.caskName}`, status: 404 };
      }
      return result;
    }

    const data = await result.response.json();

    if (typeof data.version !== 'string' || !data.version) {
      return {
        kind: 'error',
        reason: 'Homebrew API response missing version field',
      };
    }

    const info: VersionInfo = {
      version: data.version,
      releaseUrl: data.homepage,
    };

    return { kind: 'found', info, etag: result.etag };
  }
}
