import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  findPackageJson,
  findPackageJsonFromModule,
  findPackageJsonFromModuleSync,
  findPackageJsonSync,
} from "../package-json.js";

describe("findPackageJson", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-kit-pkg-test-"));
    return tmpDir;
  }

  it("finds package.json in the start directory", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "my-app", version: "1.2.3" }),
    );

    const result = await findPackageJson(dir);

    expect(result).toEqual({
      name: "my-app",
      version: "1.2.3",
      path: path.join(dir, "package.json"),
    });
  });

  it("walks up to find package.json in a parent directory", async () => {
    const dir = await setup();
    const nested = path.join(dir, "src", "lib");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "parent-app", version: "3.0.0" }),
    );

    const result = await findPackageJson(nested);

    expect(result).toEqual({
      name: "parent-app",
      version: "3.0.0",
      path: path.join(dir, "package.json"),
    });
  });

  it("returns null when no package.json exists", async () => {
    const dir = await setup();

    // Start from a deeply nested dir with no package.json anywhere above
    // (tmpdir is unlikely to have one with both name and version)
    const isolated = path.join(dir, "a", "b", "c");
    await fs.mkdir(isolated, { recursive: true });

    const result = await findPackageJson(isolated);

    // May find a package.json higher up (e.g. system-level), so just verify
    // it doesn't find one inside our temp dir
    if (result) {
      expect(result.path).not.toContain(dir);
    }
  });

  it("skips package.json without name field", async () => {
    const dir = await setup();
    const child = path.join(dir, "child");
    await fs.mkdir(child);

    // child has package.json without name
    await fs.writeFile(
      path.join(child, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    // parent has valid package.json
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "valid", version: "2.0.0" }),
    );

    const result = await findPackageJson(child);

    expect(result).toEqual({
      name: "valid",
      version: "2.0.0",
      path: path.join(dir, "package.json"),
    });
  });

  it("skips package.json without version field", async () => {
    const dir = await setup();
    const child = path.join(dir, "child");
    await fs.mkdir(child);

    await fs.writeFile(
      path.join(child, "package.json"),
      JSON.stringify({ name: "no-version" }),
    );
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "valid", version: "2.0.0" }),
    );

    const result = await findPackageJson(child);

    expect(result).toEqual({
      name: "valid",
      version: "2.0.0",
      path: path.join(dir, "package.json"),
    });
  });

  it("skips package.json with invalid JSON", async () => {
    const dir = await setup();
    const child = path.join(dir, "child");
    await fs.mkdir(child);

    await fs.writeFile(path.join(child, "package.json"), "{invalid json");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "valid", version: "1.0.0" }),
    );

    const result = await findPackageJson(child);

    expect(result).toEqual({
      name: "valid",
      version: "1.0.0",
      path: path.join(dir, "package.json"),
    });
  });

  it("skips package.json with empty name", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "", version: "1.0.0" }),
    );

    const result = await findPackageJson(dir);

    // Should skip this one since name is empty
    if (result) {
      expect(result.path).not.toBe(path.join(dir, "package.json"));
    }
  });
});

describe("findPackageJsonSync", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-kit-pkg-test-"));
    return tmpDir;
  }

  it("finds package.json in the start directory", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "sync-app", version: "1.0.0" }),
    );

    const result = findPackageJsonSync(dir);

    expect(result).toEqual({
      name: "sync-app",
      version: "1.0.0",
      path: path.join(dir, "package.json"),
    });
  });

  it("walks up to find package.json in a parent directory", async () => {
    const dir = await setup();
    const nested = path.join(dir, "deep", "nested");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "parent", version: "5.0.0" }),
    );

    const result = findPackageJsonSync(nested);

    expect(result).toEqual({
      name: "parent",
      version: "5.0.0",
      path: path.join(dir, "package.json"),
    });
  });

  it("skips invalid package.json and continues walking up", async () => {
    const dir = await setup();
    const child = path.join(dir, "child");
    await fs.mkdir(child);

    await fs.writeFile(path.join(child, "package.json"), "not json");
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "good", version: "1.0.0" }),
    );

    const result = findPackageJsonSync(child);

    expect(result).toEqual({
      name: "good",
      version: "1.0.0",
      path: path.join(dir, "package.json"),
    });
  });
});

describe("findPackageJsonFromModule", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-kit-pkg-test-"));
    return tmpDir;
  }

  it("finds package.json relative to the module URL", async () => {
    const dir = await setup();
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir);
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "my-cli", version: "1.0.0" }),
    );

    const moduleUrl = pathToFileURL(path.join(srcDir, "index.js")).href;
    const result = await findPackageJsonFromModule(moduleUrl);

    expect(result).toEqual({
      name: "my-cli",
      version: "1.0.0",
      path: path.join(dir, "package.json"),
    });
  });

  it("returns null when no package.json exists above the module", async () => {
    const dir = await setup();
    const deep = path.join(dir, "a", "b", "c");
    await fs.mkdir(deep, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(deep, "mod.js")).href;
    const result = await findPackageJsonFromModule(moduleUrl);

    if (result) {
      expect(result.path).not.toContain(dir);
    }
  });
});

describe("findPackageJsonFromModuleSync", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-kit-pkg-test-"));
    return tmpDir;
  }

  it("finds package.json relative to the module URL", async () => {
    const dir = await setup();
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir);
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "sync-cli", version: "2.0.0" }),
    );

    const moduleUrl = pathToFileURL(path.join(srcDir, "index.js")).href;
    const result = findPackageJsonFromModuleSync(moduleUrl);

    expect(result).toEqual({
      name: "sync-cli",
      version: "2.0.0",
      path: path.join(dir, "package.json"),
    });
  });
});
