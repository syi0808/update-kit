import type { NpmSourceConfig } from "../../config.js";
import { fetchWithEtag } from "./base.js";
import type {
  VersionInfo,
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
}
