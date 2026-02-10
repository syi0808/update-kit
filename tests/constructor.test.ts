import { describe, it, expect } from "vitest";
import { UpdateKit } from "../dist/index.mjs";

describe("UpdateKit Constructor Validation", () => {
  it("creates instance with minimal explicit config", () => {
    const kit = new UpdateKit({ appName: "test-app", currentVersion: "1.0.0" });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("creates instance with pkg field", () => {
    const kit = new UpdateKit({ pkg: { name: "pkg-app", version: "2.0.0" } });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("throws when appName is empty string", () => {
    expect(
      () => new UpdateKit({ appName: "", currentVersion: "1.0.0" }),
    ).toThrow("appName is required");
  });

  it("throws when currentVersion is empty string", () => {
    expect(
      () => new UpdateKit({ appName: "test", currentVersion: "" }),
    ).toThrow("currentVersion is required");
  });

  it("throws when neither appName nor pkg is provided", () => {
    expect(() => new UpdateKit({ currentVersion: "1.0.0" } as any)).toThrow(
      "appName",
    );
  });

  it("throws when neither currentVersion nor pkg is provided", () => {
    expect(() => new UpdateKit({ appName: "test" } as any)).toThrow(
      "currentVersion",
    );
  });

  it("throws for invalid semver version", () => {
    expect(
      () => new UpdateKit({ appName: "test", currentVersion: "not-a-version" }),
    ).toThrow("Invalid semver");
  });

  it("accepts pre-release versions", () => {
    const kit = new UpdateKit({
      appName: "test",
      currentVersion: "1.0.0-alpha.1",
    });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("accepts v-prefixed versions", () => {
    const kit = new UpdateKit({ appName: "test", currentVersion: "v1.2.3" });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("accepts partial coercible versions", () => {
    const kit = new UpdateKit({ appName: "test", currentVersion: "1.2" });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("creates instance with sources config", () => {
    const kit = new UpdateKit({
      appName: "test",
      currentVersion: "1.0.0",
      sources: [{ type: "github", owner: "user", repo: "repo" }],
    });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("creates instance with all optional config fields", () => {
    const kit = new UpdateKit({
      appName: "test",
      currentVersion: "1.0.0",
      sources: [],
      checkInterval: 60_000,
      cacheDir: "/tmp/test-cache",
      delegateMode: "execute",
      npmPackageName: "my-pkg",
      brewCaskName: "my-cask",
      allowReexec: true,
      assetPattern: "{app}-{version}-{target}.{ext}",
      hooks: {
        beforeCheck: () => true,
        beforeApply: () => true,
        afterApply: () => {},
        onError: () => {},
      },
    });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("creates instance with pkg and explicit overrides", () => {
    const kit = new UpdateKit({
      appName: "override-name",
      currentVersion: "5.0.0",
      pkg: { name: "pkg-name", version: "1.0.0" },
    });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("creates instance with only pkg name and explicit currentVersion", () => {
    const kit = new UpdateKit({
      currentVersion: "1.0.0",
      pkg: { name: "from-pkg", version: "2.0.0" },
    });
    expect(kit).toBeInstanceOf(UpdateKit);
  });
});

describe("UpdateKit.create() static factory", () => {
  it("creates instance when appName and currentVersion are provided", async () => {
    const kit = await UpdateKit.create({
      appName: "explicit-app",
      currentVersion: "1.0.0",
    });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("creates instance when pkg is provided", async () => {
    const kit = await UpdateKit.create({
      pkg: { name: "pkg-app", version: "2.0.0" },
    });
    expect(kit).toBeInstanceOf(UpdateKit);
  });

  it("throws when no identity info and no moduleUrl is provided", async () => {
    await expect(UpdateKit.create()).rejects.toThrow("moduleUrl");
  });

  it("creates instance with sources and explicit identity", async () => {
    const kit = await UpdateKit.create({
      appName: "test",
      currentVersion: "1.0.0",
      sources: [{ type: "npm", packageName: "test" }],
    });
    expect(kit).toBeInstanceOf(UpdateKit);
  });
});
