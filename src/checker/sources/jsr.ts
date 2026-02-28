import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';
import type { JsrSourceConfig } from '../../config.js';
import { fetchWithEtag } from './base.js';
import semver from 'semver';

export type { JsrSourceConfig } from '../../config.js';

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

    const result = await fetchWithEtag({ url }, options);

    if (result.kind !== 'response') {
      if (result.kind === 'error' && result.status === 404) {
        return {
          kind: 'error',
          reason: `JSR package not found: @${this.config.scope}/${this.config.name}`,
          status: 404,
        };
      }
      return result;
    }

    const data = await result.response.json();
    const latest = extractLatestVersion(data);

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

    return { kind: 'found', info, etag: result.etag };
  }
}

function extractLatestVersion(data: Record<string, unknown>): string | undefined {
  if (typeof data.latest === 'string') return data.latest;

  const versions = data.versions;
  if (!versions || typeof versions !== 'object') return undefined;

  const keys = Object.keys(versions as Record<string, unknown>);
  if (keys.length === 0) return undefined;

  const valid = keys.filter((k) => semver.valid(k));
  if (valid.length === 0) return keys[keys.length - 1];

  return valid.sort(semver.rcompare)[0];
}
