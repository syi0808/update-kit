import { describe, it, expect } from "vitest";
import { createVersionSource } from "../dist/index.mjs";

describe("createVersionSource", () => {
  it("creates a GitHub source", () => {
    const source = createVersionSource({
      type: "github",
      owner: "user",
      repo: "repo",
    });
    expect(source.name).toBe("github");
    expect(typeof source.fetchLatest).toBe("function");
  });

  it("creates an npm source", () => {
    const source = createVersionSource({ type: "npm", packageName: "my-pkg" });
    expect(source.name).toBe("npm");
    expect(typeof source.fetchLatest).toBe("function");
  });

  it("creates a JSR source", () => {
    const source = createVersionSource({
      type: "jsr",
      scope: "std",
      name: "test",
    });
    expect(source.name).toBe("jsr");
    expect(typeof source.fetchLatest).toBe("function");
  });

  it("creates a Brew source", () => {
    const source = createVersionSource({ type: "brew", caskName: "my-app" });
    expect(source.name).toBe("brew");
    expect(typeof source.fetchLatest).toBe("function");
  });

  it("creates a custom manifest source", () => {
    const source = createVersionSource({
      type: "custom",
      url: "https://example.com/versions.json",
    });
    expect(source.name).toBe("custom");
    expect(typeof source.fetchLatest).toBe("function");
  });

  it("throws for unknown source type", () => {
    expect(() => createVersionSource({ type: "unknown" as any })).toThrow();
  });
});
