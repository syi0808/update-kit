import type { CustomManifestSourceConfig } from "../../config.js";
import { requireHttps } from "../../utils/security.js";
import { fetchWithEtag } from "./base.js";
import type {
  VersionInfo,
  VersionSource,
  VersionSourceResult,
} from "./index.js";

export type { CustomManifestSourceConfig } from "../../config.js";

export class CustomManifestSource implements VersionSource {
  readonly name = "custom";
  private readonly config: CustomManifestSourceConfig;

  constructor(config: CustomManifestSourceConfig) {
    requireHttps(config.url, "Custom manifest URL");
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const result = await fetchWithEtag(
      { url: this.config.url, headers: { Accept: "application/json" } },
      options,
    );

    if (result.kind !== "response") return result;

    const data = await result.response.json();

    // Support nested paths (e.g. "data.latest.version")
    const fieldPath = this.config.versionField ?? "version";
    const version = getNestedValue(data, fieldPath);

    if (typeof version !== "string") {
      return {
        kind: "error",
        reason: `Version field not found in manifest: ${fieldPath}`,
      };
    }

    const info: VersionInfo = {
      version,
      releaseUrl: data.releaseUrl ?? data.url,
      releaseNotes: data.releaseNotes ?? data.changelog,
      publishedAt: data.publishedAt ?? data.date,
    };

    return { kind: "found", info, etag: result.etag };
  }
}

/**
 * Retrieves a nested value from an object using a dot-separated path.
 * Example: getNestedValue({ a: { b: "1.0" } }, "a.b") → "1.0"
 */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current != null && typeof current === "object") {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
