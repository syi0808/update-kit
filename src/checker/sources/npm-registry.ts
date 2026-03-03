import semver from "semver";
import type { NpmSourceConfig } from "../../config.js";
import { fetchWithEtag } from "./base.js";
import type {
  FetchVersionsOptions,
  VersionInfo,
  VersionListResult,
  VersionSource,
  VersionSourceResult,
} from "./index.js";

export type { NpmSourceConfig } from "../../config.js";

export class NpmRegistrySource implements VersionSource {
  readonly name = "npm";
  private readonly config: NpmSourceConfig;

  constructor(config: NpmSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const registry = this.config.registryUrl ?? "https://registry.npmjs.org";
    const url = `${registry}/${this.config.packageName}/latest`;

    const result = await fetchWithEtag(
      { url, headers: { Accept: "application/json" } },
      options,
    );

    if (result.kind !== "response") {
      // Enrich 404 error message
      if (result.kind === "error" && result.status === 404) {
        return {
          kind: "error",
          reason: `npm package not found: ${this.config.packageName}`,
          status: 404,
        };
      }
      return result;
    }

    const data = await result.response.json();

    if (typeof data.version !== "string" || !data.version) {
      return {
        kind: "error",
        reason: "npm registry response missing version field",
      };
    }

    const info: VersionInfo = {
      version: data.version,
      releaseUrl: `https://www.npmjs.com/package/${this.config.packageName}`,
      publishedAt: data.time?.[data.version],
    };

    return { kind: "found", info, etag: result.etag };
  }

  async fetchVersions(options?: FetchVersionsOptions): Promise<VersionListResult> {
    const limit = options?.limit ?? 20;
    const cursorStr = options?.cursor;
    const offset = cursorStr ? parseInt(cursorStr.replace('offset:', ''), 10) : 0;
    if (isNaN(offset) || offset < 0) {
      return { kind: 'error', reason: 'Invalid pagination cursor' };
    }

    const registry = this.config.registryUrl ?? 'https://registry.npmjs.org';
    const url = `${registry}/${this.config.packageName}`;

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      });

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `npm registry responded with failure: ${response.status}`,
        };
      }

      const data = await response.json();
      const allVersions = Object.keys(data.versions ?? {});
      const sorted = allVersions
        .filter(v => semver.valid(v))
        .sort((a, b) => semver.rcompare(a, b));

      const totalCount = sorted.length;
      const sliced = sorted.slice(offset, offset + limit);

      const versions: VersionInfo[] = sliced.map(v => ({
        version: v,
        releaseUrl: `https://www.npmjs.com/package/${this.config.packageName}/v/${v}`,
        publishedAt: data.time?.[v],
      }));

      const nextOffset = offset + limit;
      const nextCursor = nextOffset < totalCount ? `offset:${nextOffset}` : undefined;

      return { kind: 'success', versions, nextCursor, totalCount };
    } catch (error) {
      return {
        kind: 'error',
        reason: `npm registry request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
