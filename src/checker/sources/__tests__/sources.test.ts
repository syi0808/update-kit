import { afterEach, describe, expect, it, vi } from "vitest";
import { createVersionSource } from "../index.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  vi.resetAllMocks();
});

describe("GitHubReleasesSource", () => {
  const source = createVersionSource({
    type: "github",
    owner: "example",
    repo: "my-cli",
  });

  it("returns the latest release version", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"abc123"' }),
      json: async () => ({
        tag_name: "v2.1.0",
        html_url: "https://github.com/example/my-cli/releases/tag/v2.1.0",
        body: "## Changes\n- Bug fix",
        published_at: "2024-01-15T00:00:00Z",
        assets: [
          {
            name: "my-cli-2.1.0-linux-x64.tar.gz",
            browser_download_url:
              "https://github.com/example/my-cli/releases/download/v2.1.0/my-cli-2.1.0-linux-x64.tar.gz",
            size: 10485760,
          },
        ],
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("2.1.0"); // v prefix stripped
      expect(result.info.assets).toHaveLength(1);
      expect(result.etag).toBe('"abc123"');
    }
  });

  it("returns not-modified when ETag matches", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 304,
      headers: new Headers(),
    });

    const result = await source.fetchLatest({ etag: '"abc123"' });
    expect(result.kind).toBe("not-modified");
  });

  it("returns error on rate limit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("Failed to fetch");
    }
  });

  it("sends Authorization header when token is provided", async () => {
    const authedSource = createVersionSource({
      type: "github",
      owner: "example",
      repo: "my-cli",
      token: "ghp_test123",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        tag_name: "v1.0.0",
        html_url: "https://github.com/example/my-cli/releases/tag/v1.0.0",
        assets: [],
      }),
    });

    await authedSource.fetchLatest();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_test123",
        }),
      }),
    );
  });

  it("forwards AbortSignal", async () => {
    const controller = new AbortController();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ tag_name: "v1.0.0", assets: [] }),
    });

    await source.fetchLatest({ signal: controller.signal });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns error when release has no tag_name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        html_url: "https://github.com/example/my-cli/releases/latest",
        assets: [],
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("no tag_name");
    }
  });

  it("returns error when tag_name is empty string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        tag_name: "",
        assets: [],
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("no tag_name");
    }
  });

  it("handles release with no assets key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        tag_name: "v3.0.0",
        html_url: "https://github.com/example/my-cli/releases/tag/v3.0.0",
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("3.0.0");
      expect(result.info.assets).toEqual([]);
    }
  });

  it("does not include Authorization header when token is absent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ tag_name: "v1.0.0", assets: [] }),
    });

    await source.fetchLatest();

    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1]?.headers;
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("uses custom apiBaseUrl", async () => {
    const gheSource = createVersionSource({
      type: "github",
      owner: "example",
      repo: "my-cli",
      apiBaseUrl: "https://github.example.com/api/v3",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ tag_name: "v1.0.0", assets: [] }),
    });

    await gheSource.fetchLatest();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://github.example.com/api/v3/repos/example/my-cli/releases/latest",
      expect.any(Object),
    );
  });

  it("filters out assets with non-HTTPS URLs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        tag_name: "v2.0.0",
        assets: [
          {
            name: "safe.tar.gz",
            browser_download_url:
              "https://github.com/example/my-cli/releases/download/v2.0.0/safe.tar.gz",
            size: 1000,
          },
          {
            name: "unsafe.tar.gz",
            browser_download_url: "http://malicious.example.com/unsafe.tar.gz",
            size: 2000,
          },
          {
            name: "invalid.tar.gz",
            browser_download_url: "not-a-url",
            size: 500,
          },
        ],
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.assets).toHaveLength(1);
      expect(result.info.assets![0].name).toBe("safe.tar.gz");
    }
  });
});

describe("NpmRegistrySource", () => {
  const source = createVersionSource({
    type: "npm",
    packageName: "my-cli",
  });

  it("returns the latest version from npm registry", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: "3.0.0",
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("3.0.0");
      expect(result.info.releaseUrl).toBe(
        "https://www.npmjs.com/package/my-cli",
      );
    }
  });

  it("returns error for non-existent package", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("my-cli");
    }
  });

  it("returns not-modified when ETag matches", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 304,
      headers: new Headers(),
    });

    const result = await source.fetchLatest({ etag: '"npm-etag"' });
    expect(result.kind).toBe("not-modified");
  });

  it("returns error when version field is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ name: "my-cli" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("missing version field");
    }
  });

  it("returns error when version is not a string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ version: 123 }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("missing version field");
    }
  });

  it("returns error when version is empty string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ version: "" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("missing version field");
    }
  });

  it("passes through non-404 errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("includes publishedAt from time field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: "3.0.0",
        time: { "3.0.0": "2024-06-15T12:00:00Z" },
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.publishedAt).toBe("2024-06-15T12:00:00Z");
    }
  });

  it("handles missing time field gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ version: "3.0.0" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.publishedAt).toBeUndefined();
    }
  });

  it("includes etag from response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"npm-v1"' }),
      json: async () => ({ version: "3.0.0" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.etag).toBe('"npm-v1"');
    }
  });

  it("uses custom registry URL", async () => {
    const customSource = createVersionSource({
      type: "npm",
      packageName: "my-cli",
      registryUrl: "https://custom.registry.example.com",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ version: "1.0.0" }),
    });

    await customSource.fetchLatest();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom.registry.example.com/my-cli/latest",
      expect.any(Object),
    );
  });
});

describe("JsrSource", () => {
  const source = createVersionSource({
    type: "jsr",
    scope: "std",
    name: "path",
  });

  it("returns the latest version from JSR", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"jsr-etag"' }),
      json: async () => ({
        latest: "0.220.0",
        versions: {
          "0.219.0": {},
          "0.220.0": { createdAt: "2024-01-15T00:00:00Z" },
        },
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("0.220.0");
      expect(result.info.releaseUrl).toBe("https://jsr.io/@std/path");
      expect(result.info.publishedAt).toBe("2024-01-15T00:00:00Z");
      expect(result.etag).toBe('"jsr-etag"');
    }
  });

  it("falls back to last version key when latest field is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        versions: { "0.1.0": {}, "0.2.0": {} },
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("0.2.0");
    }
  });

  it("returns error when no version is available", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("returns error for non-existent package", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("@std/path");
    }
  });

  it("passes through non-404 errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("returns error when versions object is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ versions: {} }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("Could not find latest version");
    }
  });

  it("returns last key when no valid semver versions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        versions: { alpha: {}, beta: {} },
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("beta");
    }
  });

  it("sorts valid semver and returns highest", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        versions: { "1.0.0": {}, "3.0.0": {}, "2.0.0": {} },
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("3.0.0");
    }
  });

  it("returns error when versions field is not an object", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ versions: "invalid" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("includes etag from response headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"jsr-v2"' }),
      json: async () => ({
        latest: "1.0.0",
        versions: { "1.0.0": {} },
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.etag).toBe('"jsr-v2"');
    }
  });
});

describe("BrewSource", () => {
  const source = createVersionSource({
    type: "brew",
    caskName: "my-app",
  });

  it("returns the latest version from Homebrew", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: "4.2.0",
        homepage: "https://example.com/my-app",
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("4.2.0");
      expect(result.info.releaseUrl).toBe("https://example.com/my-app");
    }
  });

  it("returns error for non-existent cask", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("my-app");
    }
  });

  it("returns not-modified when ETag matches", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 304,
      headers: new Headers(),
    });

    const result = await source.fetchLatest({ etag: '"brew-etag"' });
    expect(result.kind).toBe("not-modified");
  });

  it("returns error when version field is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ name: "my-app" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("missing version field");
    }
  });

  it("returns error when version is not a string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ version: null }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("returns error when version is empty string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ version: "" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("passes through non-404 errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("handles missing homepage gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ version: "4.2.0" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("4.2.0");
      expect(result.info.releaseUrl).toBeUndefined();
    }
  });

  it("includes etag from response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"brew-v1"' }),
      json: async () => ({ version: "4.2.0" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.etag).toBe('"brew-v1"');
    }
  });
});

describe("CustomManifestSource", () => {
  it("rejects non-HTTPS URLs", () => {
    expect(() =>
      createVersionSource({
        type: "custom",
        url: "http://example.com/manifest.json",
      }),
    ).toThrow("HTTPS");
  });

  it("extracts version from nested path", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
      versionField: "data.latest.version",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        data: {
          latest: {
            version: "1.5.0",
          },
        },
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("1.5.0");
    }
  });

  it('uses default "version" field when versionField is not specified', async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: "2.0.0",
        releaseUrl: "https://example.com/release",
        releaseNotes: "New features",
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.version).toBe("2.0.0");
      expect(result.info.releaseUrl).toBe("https://example.com/release");
      expect(result.info.releaseNotes).toBe("New features");
    }
  });

  it("returns error when version field is not found", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
      versionField: "nonexistent.path",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ other: "data" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("nonexistent.path");
    }
  });

  it("returns error on HTTP failure", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
  });

  it("returns not-modified passthrough", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 304,
      headers: new Headers(),
    });

    const result = await source.fetchLatest({ etag: '"custom-etag"' });
    expect(result.kind).toBe("not-modified");
  });

  it("returns error when nested versionField hits null intermediate", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
      versionField: "a.b.c",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ a: null }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("a.b.c");
    }
  });

  it("uses data.date as publishedAt fallback", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: "1.0.0",
        date: "2024-03-01T00:00:00Z",
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.publishedAt).toBe("2024-03-01T00:00:00Z");
    }
  });

  it("uses data.changelog as releaseNotes fallback", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: "1.0.0",
        changelog: "Breaking changes...",
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.releaseNotes).toBe("Breaking changes...");
    }
  });

  it("uses data.url as releaseUrl fallback", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: "1.0.0",
        url: "https://example.com/download",
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.info.releaseUrl).toBe("https://example.com/download");
    }
  });

  it("includes etag from response", async () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/manifest.json",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"custom-v1"' }),
      json: async () => ({ version: "1.0.0" }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.etag).toBe('"custom-v1"');
    }
  });
});

describe("createVersionSource", () => {
  it("throws for unknown source type", () => {
    expect(() => createVersionSource({ type: "unknown" as any })).toThrow(
      "Unknown version source type",
    );
  });
});
