import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

describe("Module Format Verification", () => {
  const EXPECTED_EXPORTS = [
    "UpdateKit",
    "UpdateKitError",
    "DETECTION_FAILED",
    "NETWORK_ERROR",
    "CACHE_ERROR",
    "VERSION_PARSE",
    "CHECKSUM_MISMATCH",
    "APPLY_FAILED",
    "COMMAND_FAILED",
    "UNSUPPORTED_PLATFORM",
    "PERMISSION_DENIED",
    "INSECURE_URL",
    "DOWNLOAD_FAILED",
    "CHECKSUM_MISSING",
    "CHECKSUM_FETCH_FAILED",
    "CHECKSUM_PARSE_FAILED",
    "EXTRACT_FAILED",
    "COMMAND_TIMEOUT",
    "COMMAND_ABORTED",
    "COMMAND_SPAWN_FAILED",
    "normalizeVersion",
    "createVersionSource",
    "detectInstall",
    "checkUpdate",
    "applyNativeUpdate",
    "applyDelegateUpdate",
    "verifyChecksum",
    "computeSha256",
    "atomicReplace",
    "renderBanner",
    "renderProgress",
    "renderResult",
    "runHook",
    "findPackageJson",
    "findPackageJsonSync",
    "findPackageJsonFromModule",
    "findPackageJsonFromModuleSync",
    "supportsColor",
    "bold",
    "red",
    "green",
    "yellow",
    "dim",
    "stripAnsi",
    "defaultTemplates",
    "runDoctor",
    "inferSourceConfigs",
    "orderSourcesByChannel",
    "parseGitHubRepository",
    "DEFAULT_CHECK_INTERVAL_MS",
    "DEFAULT_DELEGATE_TIMEOUT_MS",
    "DEFAULT_DOWNLOAD_TIMEOUT_MS",
    "DEFAULT_BACKGROUND_TIMEOUT_MS",
    "DEFAULT_FETCH_TIMEOUT_MS",
    "DEFAULT_SOURCE_TIMEOUT_MS",
    "MAX_COMMAND_OUTPUT_BYTES",
  ].sort();

  it("ESM dynamic import resolves without error", async () => {
    const mod = await import("../dist/index.mjs");
    expect(mod).toBeDefined();
    expect(mod.UpdateKit).toBeDefined();
  });

  it("CJS require resolves without error", () => {
    const require = createRequire(import.meta.url);
    const mod = require("../dist/index.cjs");
    expect(mod).toBeDefined();
    expect(mod.UpdateKit).toBeDefined();
  });

  it("ESM exports include all expected symbols", async () => {
    const mod = await import("../dist/index.mjs");
    const exportedKeys = Object.keys(mod).sort();
    for (const key of EXPECTED_EXPORTS) {
      expect(exportedKeys, `Missing ESM export: ${key}`).toContain(key);
    }
  });

  it("CJS exports include all expected symbols", () => {
    const require = createRequire(import.meta.url);
    const mod = require("../dist/index.cjs");
    const exportedKeys = Object.keys(mod).sort();
    for (const key of EXPECTED_EXPORTS) {
      expect(exportedKeys, `Missing CJS export: ${key}`).toContain(key);
    }
  });

  it("ESM and CJS export the same keys", async () => {
    const esmMod = await import("../dist/index.mjs");
    const require = createRequire(import.meta.url);
    const cjsMod = require("../dist/index.cjs");

    const esmKeys = Object.keys(esmMod).sort();
    const cjsKeys = Object.keys(cjsMod).sort();
    expect(esmKeys).toEqual(cjsKeys);
  });

  it("exports exactly 56 symbols", async () => {
    const mod = await import("../dist/index.mjs");
    expect(Object.keys(mod)).toHaveLength(56);
  });
});
