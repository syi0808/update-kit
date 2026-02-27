import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';
import type { NpmSourceConfig } from '../../config.js';
import { fetchWithTimeout } from '../../utils/http.js';

export type { NpmSourceConfig } from '../../config.js';

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
      const response = await fetchWithTimeout(url, {
        headers,
        signal: options?.signal,
        timeoutMs: 15_000,
      });

      if (response.status === 304 && options?.etag) {
        return { kind: 'not-modified', etag: options.etag };
      }

      if (response.status === 404) {
        return {
          kind: 'error',
          reason: `npm package not found: ${this.config.packageName}`,
          status: response.status,
        };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `npm registry responded with failure: ${response.status}`,
          status: response.status,
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
