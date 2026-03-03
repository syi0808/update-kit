import { describe, expect, it } from "vitest";
import type {
  ResolvedUpdateKitConfig,
  VersionSourceConfig,
} from "../../config.js";
import {
  inferSourceConfigs,
  orderSourcesByChannel,
  parseGitHubRepository,
} from "../infer-sources.js";

// ─── parseGitHubRepository ───

describe("parseGitHubRepository", () => {
  it("parses https URL", () => {
    expect(parseGitHubRepository("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses https URL with .git suffix", () => {
    expect(parseGitHubRepository("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses git+https URL", () => {
    expect(
      parseGitHubRepository("git+https://github.com/owner/repo.git"),
    ).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses git:// URL", () => {
    expect(parseGitHubRepository("git://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses github: shorthand", () => {
    expect(parseGitHubRepository("github:owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses object with url", () => {
    expect(
      parseGitHubRepository({ url: "https://github.com/owner/repo.git" }),
    ).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses object with type and url", () => {
    expect(
      parseGitHubRepository({
        url: "https://github.com/my-org/my-cli.git",
      }),
    ).toEqual({ owner: "my-org", repo: "my-cli" });
  });

  it("handles owner/repo with dots and hyphens", () => {
    expect(
      parseGitHubRepository("https://github.com/my.org/my-cli.tool"),
    ).toEqual({ owner: "my.org", repo: "my-cli.tool" });
  });

  it("returns null for non-GitHub URL", () => {
    expect(parseGitHubRepository("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseGitHubRepository(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseGitHubRepository(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitHubRepository("")).toBeNull();
  });

  it("returns null for object without url", () => {
    expect(parseGitHubRepository({ url: undefined })).toBeNull();
  });

  it("parses ssh-style URL", () => {
    expect(parseGitHubRepository("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });
});

// ─── inferSourceConfigs ───

describe("inferSourceConfigs", () => {
  function makeConfig(
    overrides: Partial<ResolvedUpdateKitConfig> = {},
  ): ResolvedUpdateKitConfig {
    return {
      appName: "my-cli",
      currentVersion: "1.0.0",
      checkInterval: 72_000_000,
      delegateMode: "print-only",
      allowReexec: false,
      ...overrides,
    };
  }

  it("infers npm source from appName when no other info", () => {
    const sources = inferSourceConfigs(makeConfig());
    expect(sources).toEqual([{ type: "npm", packageName: "my-cli" }]);
  });

  it("uses npmPackageName over appName for npm source", () => {
    const sources = inferSourceConfigs(
      makeConfig({ npmPackageName: "@scope/my-cli" }),
    );
    expect(sources).toContainEqual({
      type: "npm",
      packageName: "@scope/my-cli",
    });
  });

  it("infers github source when repository is set", () => {
    const sources = inferSourceConfigs(
      makeConfig({ repository: "https://github.com/org/my-cli" }),
    );
    expect(sources).toContainEqual({
      type: "github",
      owner: "org",
      repo: "my-cli",
    });
  });

  it("infers brew source when brewCaskName is set", () => {
    const sources = inferSourceConfigs(makeConfig({ brewCaskName: "my-cli" }));
    expect(sources).toContainEqual({
      type: "brew",
      caskName: "my-cli",
    });
  });

  it("infers all three sources when all info available", () => {
    const sources = inferSourceConfigs(
      makeConfig({
        repository: "https://github.com/org/my-cli",
        brewCaskName: "my-cli",
      }),
    );
    expect(sources).toHaveLength(3);
    expect(sources.map((s) => s.type)).toEqual(["npm", "github", "brew"]);
  });

  it("does not infer brew when brewCaskName is not set", () => {
    const sources = inferSourceConfigs(makeConfig());
    expect(sources.find((s) => s.type === "brew")).toBeUndefined();
  });

  it("does not infer github when repository is non-GitHub URL", () => {
    const sources = inferSourceConfigs(
      makeConfig({ repository: "https://gitlab.com/org/cli" }),
    );
    expect(sources.find((s) => s.type === "github")).toBeUndefined();
  });
});

// ─── orderSourcesByChannel ───

describe("orderSourcesByChannel", () => {
  const allSources: VersionSourceConfig[] = [
    { type: "npm", packageName: "x" },
    { type: "github", owner: "o", repo: "r" },
    { type: "brew", caskName: "x" },
  ];

  it("orders npm first for npm-global channel", () => {
    const ordered = orderSourcesByChannel(allSources, "npm-global");
    expect(ordered.map((s) => s.type)).toEqual(["npm", "github", "brew"]);
  });

  it("orders brew first for brew-cask channel", () => {
    const ordered = orderSourcesByChannel(allSources, "brew-cask");
    expect(ordered.map((s) => s.type)).toEqual(["brew", "github", "npm"]);
  });

  it("orders github first for native channel", () => {
    const ordered = orderSourcesByChannel(allSources, "native");
    expect(ordered.map((s) => s.type)).toEqual(["github", "npm", "brew"]);
  });

  it("orders github first for unmanaged channel", () => {
    const ordered = orderSourcesByChannel(allSources, "unmanaged");
    expect(ordered.map((s) => s.type)).toEqual(["github", "npm", "brew"]);
  });

  it("uses default ordering for unknown channel", () => {
    const ordered = orderSourcesByChannel(allSources, "custom-channel");
    expect(ordered.map((s) => s.type)).toEqual(["npm", "github", "brew"]);
  });

  it("does not mutate the original array", () => {
    const original = [...allSources];
    orderSourcesByChannel(allSources, "brew-cask");
    expect(allSources).toEqual(original);
  });

  it("handles subset of sources", () => {
    const subset: VersionSourceConfig[] = [
      { type: "github", owner: "o", repo: "r" },
      { type: "npm", packageName: "x" },
    ];
    const ordered = orderSourcesByChannel(subset, "npm-global");
    expect(ordered.map((s) => s.type)).toEqual(["npm", "github"]);
  });

  it("puts unknown source types at the end", () => {
    const sources: VersionSourceConfig[] = [
      { type: "custom", url: "https://example.com/manifest.json" } as any,
      { type: "npm", packageName: "x" },
      { type: "github", owner: "o", repo: "r" },
    ];
    const ordered = orderSourcesByChannel(sources, "native");
    expect(ordered.map((s) => s.type)).toEqual(["github", "npm", "custom"]);
  });

  it("handles empty source array", () => {
    const ordered = orderSourcesByChannel([], "native");
    expect(ordered).toEqual([]);
  });

  it("handles single source", () => {
    const sources: VersionSourceConfig[] = [
      { type: "brew", caskName: "x" },
    ];
    const ordered = orderSourcesByChannel(sources, "native");
    expect(ordered.map((s) => s.type)).toEqual(["brew"]);
  });
});
