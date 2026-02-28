import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  findPackageJson,
  findPackageJsonFromModule,
  findPackageJsonFromModuleSync,
  findPackageJsonSync,
} from "../dist/index.mjs";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dist-pkg-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("findPackageJson (Real I/O)", () => {
  let pkgDir: string;

  beforeEach(() => {
    pkgDir = mkdtempSync(join(tmpDir, "pkg-"));
  });

  describe("async", () => {
    it("finds package.json in start directory", async () => {
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
      );
      const result = await findPackageJson(pkgDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("test-pkg");
      expect(result!.version).toBe("1.0.0");
    });

    it("walks up directories to find package.json", async () => {
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "parent-pkg", version: "2.0.0" }),
      );
      const childDir = join(pkgDir, "child", "grandchild");
      mkdirSync(childDir, { recursive: true });

      const result = await findPackageJson(childDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("parent-pkg");
    });

    it("skips package.json without name field", async () => {
      const childDir = join(pkgDir, "child");
      mkdirSync(childDir, { recursive: true });

      writeFileSync(
        join(childDir, "package.json"),
        JSON.stringify({ version: "1.0.0" }),
      );
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "valid-pkg", version: "1.0.0" }),
      );

      const result = await findPackageJson(childDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("valid-pkg");
    });

    it("skips package.json without version field", async () => {
      const childDir = join(pkgDir, "child");
      mkdirSync(childDir, { recursive: true });

      writeFileSync(
        join(childDir, "package.json"),
        JSON.stringify({ name: "no-version" }),
      );
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "valid-pkg", version: "3.0.0" }),
      );

      const result = await findPackageJson(childDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("valid-pkg");
      expect(result!.version).toBe("3.0.0");
    });

    it("skips invalid JSON and walks up", async () => {
      const childDir = join(pkgDir, "child");
      mkdirSync(childDir, { recursive: true });

      writeFileSync(join(childDir, "package.json"), "{bad json");
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "valid", version: "1.0.0" }),
      );

      const result = await findPackageJson(childDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("valid");
    });

    it("skips package.json with empty name", async () => {
      const childDir = join(pkgDir, "child");
      mkdirSync(childDir, { recursive: true });

      writeFileSync(
        join(childDir, "package.json"),
        JSON.stringify({ name: "", version: "1.0.0" }),
      );
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "non-empty", version: "1.0.0" }),
      );

      const result = await findPackageJson(childDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("non-empty");
    });
  });

  describe("sync", () => {
    it("finds package.json in start directory", () => {
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "sync-pkg", version: "1.0.0" }),
      );
      const result = findPackageJsonSync(pkgDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("sync-pkg");
    });

    it("walks up directories to find package.json", () => {
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "parent-sync", version: "2.0.0" }),
      );
      const childDir = join(pkgDir, "child", "grandchild");
      mkdirSync(childDir, { recursive: true });

      const result = findPackageJsonSync(childDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("parent-sync");
    });

    it("skips invalid JSON and walks up", () => {
      const childDir = join(pkgDir, "child");
      mkdirSync(childDir, { recursive: true });

      writeFileSync(join(childDir, "package.json"), "not json");
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "valid-sync", version: "1.0.0" }),
      );

      const result = findPackageJsonSync(childDir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("valid-sync");
    });
  });
});

describe("findPackageJsonFromModule", () => {
  it("is exported as a function", () => {
    expect(typeof findPackageJsonFromModule).toBe("function");
  });

  it("is exported as a function (sync)", () => {
    expect(typeof findPackageJsonFromModuleSync).toBe("function");
  });

  it("resolves from a valid file:// URL", async () => {
    const pkgDir = mkdtempSync(join(tmpDir, "from-module-"));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "module-pkg", version: "1.0.0" }),
    );
    const fakeModuleUrl = `file://${join(pkgDir, "index.js")}`;

    const result = await findPackageJsonFromModule(fakeModuleUrl);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("module-pkg");
    expect(result!.version).toBe("1.0.0");
  });

  it("sync resolves from a valid file:// URL", () => {
    const pkgDir = mkdtempSync(join(tmpDir, "from-module-sync-"));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "sync-module-pkg", version: "2.0.0" }),
    );
    const fakeModuleUrl = `file://${join(pkgDir, "index.js")}`;

    const result = findPackageJsonFromModuleSync(fakeModuleUrl);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("sync-module-pkg");
    expect(result!.version).toBe("2.0.0");
  });
});
