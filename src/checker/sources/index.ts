import type { VersionSourceConfig } from "../../config.js";
import { BrewSource } from "./brew-api.js";
import { CustomManifestSource } from "./custom-manifest.js";
import { GitHubReleasesSource } from "./github.js";
import { JsrSource } from "./jsr.js";
import { NpmRegistrySource } from "./npm-registry.js";

/** Version information returned by a source */
export interface VersionInfo {
  /** Latest version (semver string) */
  version: string;
  /** Release page URL */
  releaseUrl?: string;
  /** Release notes (markdown, etc.) */
  releaseNotes?: string;
  /** Downloadable asset list */
  assets?: AssetInfo[];
  /** Release publish time (ISO 8601) */
  publishedAt?: string;
}

/** Asset (downloadable file) information */
export interface AssetInfo {
  /** Filename */
  name: string;
  /** Download URL */
  url: string;
  /** File size in bytes */
  size?: number;
  /** Checksum file URL */
  checksumUrl?: string;
}

/**
 * Version source plugin interface.
 * Each source fetches latest version information from an external registry.
 */
export interface VersionSource {
  /** Source identifier name (e.g. "github", "npm") */
  name: string;

  /**
   * Fetch latest version information.
   *
   * @param options.etag - ETag from a previous response. Returns 'not-modified' if server responds 304.
   * @param options.signal - AbortSignal for request cancellation.
   * @returns Version info, not-modified response, or error.
   */
  fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult>;

  /**
   * Fetch a list of available versions with pagination.
   * Optional — sources that cannot list versions simply omit this method.
   */
  fetchVersions?(options?: FetchVersionsOptions): Promise<VersionListResult>;
}

/** fetchLatest return result */
export type VersionSourceResult =
  | { kind: "found"; info: VersionInfo; etag?: string }
  | { kind: "not-modified"; etag: string }
  | { kind: "error"; reason: string; status?: number };

/** Options for fetching a list of versions */
export interface FetchVersionsOptions {
  /** Maximum number of versions to return. Default: 20 */
  limit?: number;
  /** Opaque pagination cursor from a previous result's nextCursor */
  cursor?: string;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
}

/** Result of fetching a version list */
export type VersionListResult =
  | {
      kind: "success";
      versions: VersionInfo[];
      nextCursor?: string;
      totalCount?: number;
    }
  | { kind: "error"; reason: string };

/**
 * Factory function that creates an appropriate VersionSource instance from a config object.
 *
 * @param config - Version source configuration
 * @returns VersionSource implementation
 * @throws Error for unknown source types
 */
export function createVersionSource(
  config: VersionSourceConfig,
): VersionSource {
  switch (config.type) {
    case "github":
      return new GitHubReleasesSource(config);
    case "npm":
      return new NpmRegistrySource(config);
    case "jsr":
      return new JsrSource(config);
    case "brew":
      return new BrewSource(config);
    case "custom":
      return new CustomManifestSource(config);
    default:
      throw new Error(
        `Unknown version source type: ${(config as { type: string }).type}`,
      );
  }
}

/**
 * Fetch a list of available versions from a single source.
 * Returns an error if the source does not support version listing.
 */
export async function listVersions(
  source: VersionSource,
  options?: FetchVersionsOptions,
): Promise<VersionListResult> {
  if (!source.fetchVersions) {
    return {
      kind: "error",
      reason: `Source "${source.name}" does not support version listing`,
    };
  }
  return source.fetchVersions(options);
}

export type {
  BrewSourceConfig,
  CustomManifestSourceConfig,
  GitHubSourceConfig,
  JsrSourceConfig,
  NpmSourceConfig,
} from "../../config.js";
