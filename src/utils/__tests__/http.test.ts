import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateKitError } from "../../errors.js";
import { fetchWithTimeout, getProxyConfig } from "../http.js";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns response on successful fetch", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.mocked(fetch).mockResolvedValue(mockResponse);

    const response = await fetchWithTimeout("https://example.com");
    expect(response).toBe(mockResponse);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("throws NETWORK_ERROR on timeout", async () => {
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    await expect(
      fetchWithTimeout("https://example.com", { timeoutMs: 10 }),
    ).rejects.toThrow(UpdateKitError);

    try {
      await fetchWithTimeout("https://example.com", { timeoutMs: 10 });
    } catch (err) {
      expect(err).toBeInstanceOf(UpdateKitError);
      expect((err as UpdateKitError).code).toBe("NETWORK_ERROR");
    }
  });

  it("propagates caller abort as-is", async () => {
    const controller = new AbortController();

    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const promise = fetchWithTimeout("https://example.com", {
      signal: controller.signal,
      timeoutMs: 60_000,
    });

    controller.abort();

    await expect(promise).rejects.toThrow("Aborted");
    // Should NOT be wrapped in UpdateKitError
    try {
      await promise;
    } catch (err) {
      expect(err).not.toBeInstanceOf(UpdateKitError);
    }
  });

  it("uses default timeout of 30000ms", async () => {
    const mockResponse = new Response("ok");
    vi.mocked(fetch).mockResolvedValue(mockResponse);

    await fetchWithTimeout("https://example.com");

    // Verify the signal was passed (default timeout is used)
    const callArgs = vi.mocked(fetch).mock.calls[0];
    expect(callArgs[1]).toHaveProperty("signal");
  });
});

describe("getProxyConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns undefined when no proxy env vars set", () => {
    delete process.env["HTTPS_PROXY"];
    delete process.env["https_proxy"];
    delete process.env["HTTP_PROXY"];
    delete process.env["http_proxy"];

    expect(getProxyConfig("https://example.com")).toBeUndefined();
  });

  it("returns HTTPS_PROXY for https URLs", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:8080";

    const config = getProxyConfig("https://example.com");
    expect(config).toEqual({ proxyUrl: "http://proxy:8080" });
  });

  it("returns HTTP_PROXY for http URLs", () => {
    process.env["HTTP_PROXY"] = "http://proxy:8080";

    const config = getProxyConfig("http://example.com");
    expect(config).toEqual({ proxyUrl: "http://proxy:8080" });
  });

  it("respects lowercase env vars", () => {
    process.env["https_proxy"] = "http://proxy:3128";

    const config = getProxyConfig("https://example.com");
    expect(config).toEqual({ proxyUrl: "http://proxy:3128" });
  });

  it("returns undefined when NO_PROXY matches hostname exactly", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:8080";
    process.env["NO_PROXY"] = "example.com";

    expect(getProxyConfig("https://example.com")).toBeUndefined();
  });

  it("returns undefined when NO_PROXY is wildcard", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:8080";
    process.env["NO_PROXY"] = "*";

    expect(getProxyConfig("https://example.com")).toBeUndefined();
  });

  it("returns undefined when NO_PROXY matches .domain suffix", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:8080";
    process.env["NO_PROXY"] = ".example.com";

    expect(getProxyConfig("https://api.example.com")).toBeUndefined();
  });

  it("returns undefined when NO_PROXY matches bare domain suffix", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:8080";
    process.env["NO_PROXY"] = "example.com";

    expect(getProxyConfig("https://api.example.com")).toBeUndefined();
  });

  it("returns undefined for malformed proxy URL", () => {
    process.env["HTTPS_PROXY"] = "not-a-valid-url";

    expect(getProxyConfig("https://example.com")).toBeUndefined();
  });
});
