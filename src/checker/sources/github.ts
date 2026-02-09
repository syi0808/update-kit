import type { GitHubSourceConfig } from "../../config.js";
import { DEFAULT_SOURCE_TIMEOUT_MS } from "../../constants.js";
import { fetchWithEtag } from "./base.js";
import type {
  AssetInfo,
  FetchVersionsOptions,
  VersionInfo,
  VersionListResult,
  VersionSource,
  VersionSourceResult,
} from "./index.js";

export type { GitHubSourceConfig } from "../../config.js";

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
  readonly name = "github";
  private readonly config: GitHubSourceConfig;

  constructor(config: GitHubSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const baseUrl = this.config.apiBaseUrl ?? "https://api.github.com";
    const url = `${baseUrl}/repos/${this.config.owner}/${this.config.repo}/releases/latest`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "update-kit",
    };

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const result = await fetchWithEtag(
      { url, headers, timeoutMs: DEFAULT_SOURCE_TIMEOUT_MS },
      options,
    );

    if (result.kind !== "response") return result;

    const data: GitHubReleaseResponse = await result.response.json();

    if (!data.tag_name) {
      return {
        kind: "error",
        reason: "GitHub release has no tag_name",
      };
    }

    // Strip 'v' prefix from tag_name
    const version = data.tag_name.replace(/^v/, "");

    const assets: AssetInfo[] = (data.assets ?? [])
      .filter((asset: GitHubReleaseAsset) => {
        try {
          return new URL(asset.browser_download_url).protocol === "https:";
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

    return { kind: "found", info, etag: result.etag };
  }

  async fetchVersions(
    options?: FetchVersionsOptions,
  ): Promise<VersionListResult> {
    const limit = options?.limit ?? 20;
    const cursorStr = options?.cursor;
    const page = cursorStr ? parseInt(cursorStr.replace("page:", ""), 10) : 1;
    if (Number.isNaN(page) || page < 1) {
      return { kind: "error", reason: "Invalid pagination cursor" };
    }

    const baseUrl = this.config.apiBaseUrl ?? "https://api.github.com";
    const url = `${baseUrl}/repos/${this.config.owner}/${this.config.repo}/releases?per_page=${limit}&page=${page}`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "update-kit",
    };

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: options?.signal,
      });

      if (!response.ok) {
        return {
          kind: "error",
          reason: `GitHub API responded with failure: ${response.status} ${response.statusText}`,
        };
      }

      interface GitHubAsset {
        name: string;
        browser_download_url: string;
        size: number;
      }

      interface GitHubRelease {
        tag_name: string;
        html_url: string;
        body: string;
        published_at: string;
        assets: GitHubAsset[];
      }

      const data = (await response.json()) as GitHubRelease[];

      const versions: VersionInfo[] = data.map((release) => ({
        version: release.tag_name?.replace(/^v/, "") ?? release.tag_name,
        releaseUrl: release.html_url,
        releaseNotes: release.body,
        publishedAt: release.published_at,
        assets: (release.assets ?? []).map((asset) => ({
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
        })),
      }));

      const nextCursor = data.length >= limit ? `page:${page + 1}` : undefined;

      return { kind: "success", versions, nextCursor };
    } catch (error) {
      return {
        kind: "error",
        reason: `GitHub API request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
