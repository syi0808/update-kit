import type { VersionSource, VersionSourceResult, VersionInfo, AssetInfo } from './index.js';

export interface GitHubSourceConfig {
  type: 'github';
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** GitHub API token (optional, for rate limit avoidance) */
  token?: string;
  /** API base URL (for GitHub Enterprise, etc.) */
  apiBaseUrl?: string;
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

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `GitHub API responded with failure: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      // Strip 'v' prefix from tag_name
      const version = data.tag_name?.replace(/^v/, '') ?? data.tag_name;

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
