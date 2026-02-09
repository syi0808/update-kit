import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';

export interface NpmSourceConfig {
  type: 'npm';
  /** npm package name */
  packageName: string;
  /** Registry URL (default: https://registry.npmjs.org) */
  registryUrl?: string;
}

export class NpmRegistrySource implements VersionSource {
  readonly name = 'npm';
  private readonly config: NpmSourceConfig;

  constructor(config: NpmSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const registry = this.config.registryUrl ?? 'https://registry.npmjs.org';
    const url = `${registry}/${this.config.packageName}/latest`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

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
          reason: `npm package not found: ${this.config.packageName}`,
        };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `npm registry responded with failure: ${response.status}`,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      const info: VersionInfo = {
        version: data.version,
        releaseUrl: `https://www.npmjs.com/package/${this.config.packageName}`,
        publishedAt: data.time?.[data.version],
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `npm registry request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
