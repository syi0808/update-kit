import type { VersionSource, VersionSourceResult, VersionInfo, AssetInfo } from './index.js';
import type { GitHubSourceConfig } from '../../config.js';
import { fetchWithEtag } from './base.js';
import { DEFAULT_SOURCE_TIMEOUT_MS } from '../../constants.js';

export type { GitHubSourceConfig } from '../../config.js';

/** Minimal shape of a GitHub release asset from the API. */
interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

/** Minimal shape of a GitHub release response from the API. */
interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

export class GitHubReleasesSource implements VersionSource {
  readonly name = 'github';
  private readonly config: GitHubSourceConfig;

  constructor(config: GitHubSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const baseUrl = this.config.apiBaseUrl ?? 'https://api.github.com';
    const url = `${baseUrl}/repos/${this.config.owner}/${this.config.repo}/releases/latest`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'update-kit',
    };

    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    const result = await fetchWithEtag(
      { url, headers, timeoutMs: DEFAULT_SOURCE_TIMEOUT_MS },
      options,
    );

    if (result.kind !== 'response') return result;

    const data: GitHubReleaseResponse = await result.response.json();

    if (!data.tag_name) {
      return {
        kind: 'error',
        reason: 'GitHub release has no tag_name',
      };
    }

    // Strip 'v' prefix from tag_name
    const version = data.tag_name.replace(/^v/, '');

    const assets: AssetInfo[] = (data.assets ?? [])
      .filter((asset: GitHubReleaseAsset) => {
        try {
          return new URL(asset.browser_download_url).protocol === 'https:';
        } catch {
          return false;
        }
      })
      .map((asset: GitHubReleaseAsset) => ({
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size,
      }));

    const info: VersionInfo = {
      version,
      releaseUrl: data.html_url,
      releaseNotes: data.body,
      assets,
      publishedAt: data.published_at,
    };

    return { kind: 'found', info, etag: result.etag };
  }
}
