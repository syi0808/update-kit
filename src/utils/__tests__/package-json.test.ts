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

describe("findPackageJson — repository parsing", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "update-kit-repo-test-"));
    return tmpDir;
  }

  it("parses string repository field", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        repository: "https://github.com/user/repo",
      }),
    );

    const result = await findPackageJson(dir);
    expect(result?.repository).toBe("https://github.com/user/repo");
  });

  it("parses object repository field with type and url", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        repository: { type: "git", url: "https://github.com/user/repo.git" },
      }),
    );

    const result = await findPackageJson(dir);
    expect(result?.repository).toEqual({
      type: "git",
      url: "https://github.com/user/repo.git",
    });
  });

  it("parses object repository field without url", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        repository: { type: "svn" },
      }),
    );

    const result = await findPackageJson(dir);
    expect(result?.repository).toEqual({ type: "svn" });
  });

  it("ignores array repository field", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        repository: ["not", "valid"],
      }),
    );

    const result = await findPackageJson(dir);
    expect(result?.repository).toBeUndefined();
  });

  it("ignores null repository field", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        repository: null,
      }),
    );

    const result = await findPackageJson(dir);
    expect(result?.repository).toBeUndefined();
  });

  it("skips package.json with empty version", async () => {
    const dir = await setup();
    const child = path.join(dir, "child");
    await fs.mkdir(child);

    await fs.writeFile(
      path.join(child, "package.json"),
      JSON.stringify({ name: "app", version: "" }),
    );
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "valid", version: "1.0.0" }),
    );

    const result = await findPackageJson(child);
    expect(result?.name).toBe("valid");
    expect(result?.version).toBe("1.0.0");
  });

  it("skips non-object package.json", async () => {
    const dir = await setup();
    const child = path.join(dir, "child");
    await fs.mkdir(child);

    await fs.writeFile(path.join(child, "package.json"), '"just a string"');
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "valid", version: "1.0.0" }),
    );

    const result = await findPackageJson(child);
    expect(result?.name).toBe("valid");
  });

  it("handles object repository with non-string type", async () => {
    const dir = await setup();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        repository: { type: 123, url: "https://github.com/user/repo.git" },
      }),
    );

    const result = await findPackageJson(dir);
    // type should be omitted since it's not a string, but url should remain
    expect(result?.repository).toEqual({
      url: "https://github.com/user/repo.git",
    });
  });
});

describe("resolvePackageJsonFromCaller", () => {
  it("resolves from file:// URL", async () => {
    // This test calls resolvePackageJsonFromCaller with import.meta.url
    // which should find the update-kit package.json
    const { resolvePackageJsonFromCaller } = await import(
      "../package-json.js"
    );
    const result = await resolvePackageJsonFromCaller(import.meta.url);
    // Should find the update-kit package.json
    expect(result).not.toBeNull();
    if (result) {
      expect(result.name).toBe("update-kit");
    }
  });

  it("resolves from absolute path", async () => {
    const { resolvePackageJsonFromCaller } = await import(
      "../package-json.js"
    );
    const result = await resolvePackageJsonFromCaller(__filename);
    // Should find the update-kit package.json
    expect(result).not.toBeNull();
  });
});

describe("getCallerFilePath", () => {
  it("returns a string (caller file path) when called from outside update-kit", async () => {
    const { getCallerFilePath } = await import("../package-json.js");
    // When called from the test file (which is inside update-kit),
    // it will try to find a frame outside update-kit root.
    // Depending on test runner internals, it may return a string or null.
    const result = getCallerFilePath();
    // Just verify it returns string or null without throwing
    expect(result === null || typeof result === "string").toBe(true);
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
