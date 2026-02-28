import { DEFAULT_SOURCE_TIMEOUT_MS } from "../../constants.js";
import { fetchWithTimeout } from "../../utils/http.js";
import type { VersionSourceResult } from "./index.js";

export interface FetchOptions {
  etag?: string;
  signal?: AbortSignal;
}

export interface SourceFetchConfig {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type SourceFetchResult =
  | { kind: "not-modified"; etag: string }
  | { kind: "response"; response: Response; etag: string | undefined }
  | { kind: "error"; reason: string; status?: number };

/**
 * Shared fetch helper that handles ETag/304 logic for all version sources.
 * Returns the raw response for 'response' kind, letting each source
 * do its own JSON parsing and field extraction.
 */
export async function fetchWithEtag(
  config: SourceFetchConfig,
  options?: FetchOptions,
): Promise<SourceFetchResult> {
  const headers: Record<string, string> = { ...config.headers };

  if (options?.etag) {
    headers["If-None-Match"] = options.etag;
  }

  try {
    const response = await fetchWithTimeout(config.url, {
      headers,
      signal: options?.signal,
      timeoutMs: config.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS,
    });

    if (response.status === 304 && options?.etag) {
      return { kind: "not-modified", etag: options.etag };
    }

    if (!response.ok) {
      return {
        kind: "error",
        reason: `HTTP ${response.status} ${response.statusText}`,
        status: response.status,
      };
    }

    const etag = response.headers.get("etag") ?? undefined;
    return { kind: "response", response, etag };
  } catch (error) {
    return {
      kind: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
