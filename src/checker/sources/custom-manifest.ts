import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';

export interface CustomManifestSourceConfig {
  type: 'custom';
  /** Manifest JSON URL */
  url: string;
  /** Version field name (default: "version"). Supports dot-notation for nested paths (e.g. "data.latest.version") */
  versionField?: string;
}

export class CustomManifestSource implements VersionSource {
  readonly name = 'custom';
  private readonly config: CustomManifestSourceConfig;

  constructor(config: CustomManifestSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (options?.etag) {
      headers['If-None-Match'] = options.etag;
    }

    try {
      const response = await fetch(this.config.url, {
        headers,
        signal: options?.signal,
      });

      if (response.status === 304 && options?.etag) {
        return { kind: 'not-modified', etag: options.etag };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `Custom manifest responded with failure: ${response.status}`,
          status: response.status,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      // Support nested paths (e.g. "data.latest.version")
      const fieldPath = this.config.versionField ?? 'version';
      const version = getNestedValue(data, fieldPath);

      if (typeof version !== 'string') {
        return {
          kind: 'error',
          reason: `Version field not found in manifest: ${fieldPath}`,
        };
      }

      const info: VersionInfo = {
        version,
        releaseUrl: data.releaseUrl ?? data.url,
        releaseNotes: data.releaseNotes ?? data.changelog,
        publishedAt: data.publishedAt ?? data.date,
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `Custom manifest request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * Retrieves a nested value from an object using a dot-separated path.
 * Example: getNestedValue({ a: { b: "1.0" } }, "a.b") → "1.0"
 */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current != null && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
