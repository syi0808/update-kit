import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';

export interface BrewSourceConfig {
  type: 'brew';
  /** Homebrew cask name */
  caskName: string;
}

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

    const headers: Record<string, string> = {};

    if (options?.etag) {
      headers['If-None-Match'] = options.etag;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: options?.signal,
      });

      if (response.status === 304 && options?.etag) {
        return { kind: 'not-modified', etag: options.etag };
      }

      if (response.status === 404) {
        return {
          kind: 'error',
          reason: `Homebrew cask not found: ${this.config.caskName}`,
        };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `Homebrew API responded with failure: ${response.status}`,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      const info: VersionInfo = {
        version: data.version,
        releaseUrl: data.homepage,
        publishedAt: data.installed?.[0]?.time,
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `Homebrew API request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
