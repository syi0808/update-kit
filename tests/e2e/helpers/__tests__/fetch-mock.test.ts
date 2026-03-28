import { afterEach, describe, expect, it } from "vitest";
import { setupFetchMock } from "../fetch-mock.js";

describe("setupFetchMock", () => {
  let mock: ReturnType<typeof setupFetchMock> | undefined;

  afterEach(() => {
    mock?.restore();
  });

  it("intercepts fetch matching a string URL", async () => {
    mock = setupFetchMock([
      {
        url: "https://api.example.com/data",
        response: { body: { version: "2.0.0" } },
      },
    ]);
    const res = await fetch("https://api.example.com/data");
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.version).toBe("2.0.0");
  });

  it("intercepts fetch matching a RegExp URL", async () => {
    mock = setupFetchMock([
      {
        url: /api\.github\.com\/repos\/.*\/releases\/latest/,
        response: { body: { tag_name: "v2.0.0" } },
      },
    ]);
    const res = await fetch(
      "https://api.github.com/repos/owner/repo/releases/latest",
    );
    const json = await res.json();
    expect(json.tag_name).toBe("v2.0.0");
  });

  it("returns custom status and headers", async () => {
    mock = setupFetchMock([
      {
        url: "https://example.com/notfound",
        response: {
          status: 404,
          headers: { "x-custom": "val" },
          body: "not found",
        },
      },
    ]);
    const res = await fetch("https://example.com/notfound");
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    expect(res.headers.get("x-custom")).toBe("val");
  });

  it("throws on unmatched URLs", async () => {
    mock = setupFetchMock([]);
    await expect(fetch("https://unknown.com/path")).rejects.toThrow(
      /No fetch mock route matched/,
    );
  });

  it("records calls for assertion", async () => {
    mock = setupFetchMock([{ url: /.*/, response: { body: "ok" } }]);
    await fetch("https://a.com/1");
    await fetch("https://b.com/2", { method: "POST" });
    const calls = mock.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://a.com/1");
    expect(calls[1].url).toBe("https://b.com/2");
    expect(calls[1].method).toBe("POST");
  });

  it("restores original fetch", async () => {
    const originalFetch = globalThis.fetch;
    mock = setupFetchMock([]);
    expect(globalThis.fetch).not.toBe(originalFetch);
    mock.restore();
    expect(globalThis.fetch).toBe(originalFetch);
    mock = undefined;
  });

  it("supports binary Buffer body", async () => {
    const data = Buffer.from([0x1f, 0x8b, 0x08]);
    mock = setupFetchMock([
      {
        url: /\.tar\.gz$/,
        response: {
          body: data,
          headers: { "content-type": "application/gzip" },
        },
      },
    ]);
    const res = await fetch("https://example.com/app.tar.gz");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);
  });

  it("supports ETag/304 via response status", async () => {
    mock = setupFetchMock([
      {
        url: "https://api.example.com/check",
        response: { status: 304, headers: { etag: '"abc"' } },
      },
    ]);
    const res = await fetch("https://api.example.com/check", {
      headers: { "if-none-match": '"abc"' },
    });
    expect(res.status).toBe(304);
  });
});
