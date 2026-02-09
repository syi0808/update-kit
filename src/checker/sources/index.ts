import type { VersionSourceConfig } from '../../config.js';
import { GitHubReleasesSource, type GitHubSourceConfig } from './github.js';
import { NpmRegistrySource, type NpmSourceConfig } from './npm-registry.js';
import { JsrSource, type JsrSourceConfig } from './jsr.js';
import { BrewSource, type BrewSourceConfig } from './brew-api.js';
import {
  CustomManifestSource,
  type CustomManifestSourceConfig,
} from './custom-manifest.js';

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
}

/** fetchLatest return result */
export type VersionSourceResult =
  | { kind: 'found'; info: VersionInfo; etag?: string }
  | { kind: 'not-modified'; etag: string }
  | { kind: 'error'; reason: string };

/**
 * Factory function that creates an appropriate VersionSource instance from a config object.
 *
 * @param config - Version source configuration
 * @returns VersionSource implementation
 * @throws Error for unknown source types
 */
export function createVersionSource(config: VersionSourceConfig): VersionSource {
  switch (config.type) {
    case 'github':
      return new GitHubReleasesSource(config as unknown as GitHubSourceConfig);
    case 'npm':
      return new NpmRegistrySource(config as unknown as NpmSourceConfig);
    case 'jsr':
      return new JsrSource(config as unknown as JsrSourceConfig);
    case 'brew':
      return new BrewSource(config as unknown as BrewSourceConfig);
    case 'custom':
      return new CustomManifestSource(config as unknown as CustomManifestSourceConfig);
    default:
      throw new Error(`Unknown version source type: ${(config as any).type}`);
  }
}

export type {
  GitHubSourceConfig,
  NpmSourceConfig,
  JsrSourceConfig,
  BrewSourceConfig,
  CustomManifestSourceConfig,
};
