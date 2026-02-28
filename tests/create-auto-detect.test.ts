import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const distPath = pathToFileURL(resolve("dist/index.mjs")).href;

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "update-kit-auto-detect-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function setupExternalPackage(name: string, version: string) {
  const pkgDir = join(tmpDir, name);
  const srcDir = join(pkgDir, "src");
  mkdirSync(srcDir, { recursive: true });

  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version }),
  );

  return { pkgDir, srcDir };
}

function writeScript(dir: string, filename: string, code: string) {
  const scriptPath = join(dir, filename);
  writeFileSync(scriptPath, code);
  return scriptPath;
}

function runScript(scriptPath: string): string {
  return execFileSync("node", [scriptPath], {
    encoding: "utf-8",
    timeout: 10_000,
  });
}

describe("UpdateKit.create() auto-detection via child process", () => {
  it("detects the external package, not update-kit itself", () => {
    const { srcDir } = setupExternalPackage("test-external-app", "9.9.9");

    const script = writeScript(
      srcDir,
      "test.mjs",
      `
import { UpdateKit } from ${JSON.stringify(distPath)};

const kit = await UpdateKit.create({ sources: [] });
// TypeScript 'private' is erased at runtime
console.log(JSON.stringify({
  appName: kit.config.appName,
  currentVersion: kit.config.currentVersion,
}));
`,
    );

    const output = runScript(script);
    const result = JSON.parse(output.trim());

    expect(result.appName).toBe("test-external-app");
    expect(result.currentVersion).toBe("9.9.9");
  });

  it("detects correctly with explicit moduleUrl as well", () => {
    const { srcDir } = setupExternalPackage("test-module-url-app", "3.2.1");

    const script = writeScript(
      srcDir,
      "test.mjs",
      `
import { UpdateKit } from ${JSON.stringify(distPath)};

const kit = await UpdateKit.create(
  { sources: [] },
  { moduleUrl: import.meta.url },
);
console.log(JSON.stringify({
  appName: kit.config.appName,
  currentVersion: kit.config.currentVersion,
}));
`,
    );

    const output = runScript(script);
    const result = JSON.parse(output.trim());

    expect(result.appName).toBe("test-module-url-app");
    expect(result.currentVersion).toBe("3.2.1");
  });

  it("does not resolve to update-kit own package.json", () => {
    const { srcDir } = setupExternalPackage("not-update-kit", "1.0.0");

    const script = writeScript(
      srcDir,
      "test.mjs",
      `
import { UpdateKit } from ${JSON.stringify(distPath)};

const kit = await UpdateKit.create({ sources: [] });
console.log(JSON.stringify({
  appName: kit.config.appName,
}));
`,
    );

    const output = runScript(script);
    const result = JSON.parse(output.trim());

    expect(result.appName).not.toBe("update-kit");
    expect(result.appName).toBe("not-update-kit");
  });
});
