import { DEFAULT_FETCH_TIMEOUT_MS } from "../constants.js";
import { NETWORK_ERROR, UpdateKitError } from "../errors.js";

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Fetch with an AbortController-based timeout.
 * Composes with the caller's AbortSignal if provided.
 * Timeout errors are wrapped in UpdateKitError(NETWORK_ERROR).
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    signal: externalSignal,
    ...fetchOptions
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Forward external abort to our controller
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    // If the external signal was aborted, re-throw as-is (caller-initiated)
    if (externalSignal?.aborted) {
      throw error;
    }
    // Our timeout triggered the abort
    if (controller.signal.aborted) {
      throw new UpdateKitError(
        NETWORK_ERROR,
        `Request timed out after ${timeoutMs}ms: ${url}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export interface ProxyConfig {
  proxyUrl: string;
}

/**
 * Read proxy configuration from environment variables.
 * Returns the proxy URL to use, or undefined if no proxy applies.
 */
export function getProxyConfig(url: string): ProxyConfig | undefined {
  const parsedUrl = new URL(url);
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;

  if (noProxy && shouldBypassProxy(parsedUrl.hostname, noProxy)) {
    return undefined;
  }

  const proxyUrl =
    parsedUrl.protocol === "https:"
      ? process.env.HTTPS_PROXY || process.env.https_proxy
      : process.env.HTTP_PROXY || process.env.http_proxy;

  if (!proxyUrl) return undefined;

  // Validate the proxy URL
  try {
    new URL(proxyUrl);
  } catch {
    return undefined;
  }

  return { proxyUrl };
}

/**
 * Check whether a hostname should bypass the proxy based on NO_PROXY.
 * Supports: wildcard '*', exact match, '.domain' suffix, bare domain suffix.
 */
function shouldBypassProxy(hostname: string, noProxy: string): boolean {
  const entries = noProxy.split(",").map((e) => e.trim().toLowerCase());
  const host = hostname.toLowerCase();

  for (const entry of entries) {
    if (entry === "*") return true;
    if (host === entry) return true;
    if (entry.startsWith(".") && host.endsWith(entry)) return true;
    if (!entry.startsWith(".") && host.endsWith(`.${entry}`)) return true;
  }
  return false;
}
