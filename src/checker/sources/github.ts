import type { VersionSource, VersionSourceResult, VersionInfo, AssetInfo } from './index.js';
import type { GitHubSourceConfig } from '../../config.js';
import { fetchWithTimeout } from '../../utils/http.js';

export type { GitHubSourceConfig } from '../../config.js';

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

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `GitHub API responded with failure: ${response.status} ${response.statusText}`,
          status: response.status,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      if (!data.tag_name) {
        return {
          kind: 'error',
          reason: 'GitHub release has no tag_name',
        };
      }

      // Strip 'v' prefix from tag_name
      const version = data.tag_name.replace(/^v/, '');

      const assets: AssetInfo[] = (data.assets ?? []).map((asset: any) => ({
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

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `GitHub API request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
