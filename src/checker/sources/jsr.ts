import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';

export interface JsrSourceConfig {
  type: 'jsr';
  /** Scope (without @, e.g. "std") */
  scope: string;
  /** Package name */
  name: string;
}

export class JsrSource implements VersionSource {
  readonly name = 'jsr';
  private readonly config: JsrSourceConfig;

  constructor(config: JsrSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const url = `https://jsr.io/@${this.config.scope}/${this.config.name}/meta.json`;

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
          reason: `JSR package not found: @${this.config.scope}/${this.config.name}`,
          status: response.status,
        };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `JSR responded with failure: ${response.status}`,
          status: response.status,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      // Extract latest version from meta.json
      const latest = data.latest ?? Object.keys(data.versions ?? {}).pop();

      if (!latest) {
        return {
          kind: 'error',
          reason: 'Could not find latest version in JSR metadata',
        };
      }

      const versionMeta = data.versions?.[latest];
      const info: VersionInfo = {
        version: latest,
        releaseUrl: `https://jsr.io/@${this.config.scope}/${this.config.name}`,
        publishedAt: versionMeta?.createdAt,
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `JSR request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
