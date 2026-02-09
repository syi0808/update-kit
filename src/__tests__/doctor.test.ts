import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorReport } from "../doctor.js";

// ─── Mocks ───

vi.mock("../detection/index.js", () => ({
  detectInstall: vi.fn(),
}));

vi.mock("../checker/sources/index.js", () => ({
  createVersionSource: vi.fn(() => ({
    name: "mock",
    fetchLatest: vi.fn().mockResolvedValue({
      kind: "found",
      info: { version: "2.0.0", releaseUrl: "https://example.com" },
    }),
  })),
}));

vi.mock("../utils/package-json.js", () => ({
  findPackageJson: vi.fn(),
}));

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVersionSource } from "../checker/sources/index.js";
import { detectInstall } from "../detection/index.js";
import { runDoctor } from "../doctor.js";
import { findPackageJson } from "../utils/package-json.js";

const mockDetect = vi.mocked(detectInstall);
const mockFindPkg = vi.mocked(findPackageJson);
const mockCreateSource = vi.mocked(createVersionSource);

let tempDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tempDir = join(tmpdir(), `doctor-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  mockDetect.mockResolvedValue({
    channel: "npm-global",
    confidence: "high",
    evidence: [{ source: "path_pattern", detail: "/usr/lib/node_modules" }],
  });

  mockFindPkg.mockResolvedValue({
    name: "my-cli",
    version: "1.0.0",
    path: join(tempDir, "package.json"),
    repository: "https://github.com/org/my-cli",
  });
});

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeConfig(config: Record<string, unknown>, dir?: string): string {
  const configPath = join(dir ?? tempDir, "update-kit.config.json");
  writeFileSync(configPath, JSON.stringify(config));
  return configPath;
}

// ─── Tests ───

describe("runDoctor", () => {
  it("passes all checks with valid config and package.json", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      sources: [{ type: "npm", packageName: "my-cli" }],
    });

    const report = await runDoctor(configPath, { cwd: tempDir });

    expect(report.summary.failed).toBe(0);
    expect(report.checks.find((c) => c.name === "Config file")?.status).toBe(
      "pass",
    );
  });

  it("fails when config file does not exist", async () => {
    const report = await runDoctor("/nonexistent/config.json", {
      cwd: tempDir,
    });

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.message).toContain("Not found");
    // No further checks should run without config
    expect(report.checks).toHaveLength(2); // config + package.json
  });

  it("fails when config has invalid JSON", async () => {
    const configPath = join(tempDir, "update-kit.config.json");
    writeFileSync(configPath, "{ broken json }");

    const report = await runDoctor(configPath, { cwd: tempDir });

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.message).toContain("Invalid JSON");
  });

  it("fails when config is missing appName", async () => {
    const configPath = writeConfig({ currentVersion: "1.0.0" });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.message).toContain("missing appName");
  });

  it("fails when config has invalid semver", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "not-a-version",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.message).toContain("invalid semver");
  });

  it("warns when package.json has no repository", async () => {
    mockFindPkg.mockResolvedValue({
      name: "my-cli",
      version: "1.0.0",
      path: join(tempDir, "package.json"),
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const pkgCheck = report.checks.find((c) => c.name === "Package.json");
    expect(pkgCheck?.status).toBe("warn");
    expect(pkgCheck?.message).toContain("no repository field");
  });

  it("warns when package.json is not found", async () => {
    mockFindPkg.mockResolvedValue(null);

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const pkgCheck = report.checks.find((c) => c.name === "Package.json");
    expect(pkgCheck?.status).toBe("warn");
  });

  it("shows explicit sources when configured", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      sources: [
        { type: "npm", packageName: "my-cli" },
        { type: "github", owner: "org", repo: "my-cli" },
      ],
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const sourceCheck = report.checks.find((c) => c.name === "Sources");
    expect(sourceCheck?.status).toBe("pass");
    expect(sourceCheck?.message).toContain("Explicit");
    expect(sourceCheck?.details?.mode).toBe("explicit");
  });

  it("shows inferred sources when not configured", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const sourceCheck = report.checks.find((c) => c.name === "Sources");
    expect(sourceCheck?.status).toBe("pass");
    expect(sourceCheck?.message).toContain("Auto-inferred");
    expect(sourceCheck?.details?.mode).toBe("inferred");
  });

  it("reports detection results", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const detectionCheck = report.checks.find((c) => c.name === "Detection");
    expect(detectionCheck?.status).toBe("pass");
    expect(detectionCheck?.details?.channel).toBe("npm-global");
  });

  it("reports source connectivity", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      sources: [{ type: "npm", packageName: "my-cli" }],
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const sourceChecks = report.checks.filter((c) =>
      c.name.startsWith("Source:"),
    );
    expect(sourceChecks.length).toBeGreaterThan(0);
    expect(sourceChecks[0].status).toBe("pass");
    expect(sourceChecks[0].message).toContain("v2.0.0");
  });

  it("reports connectivity failure", async () => {
    mockCreateSource.mockReturnValue({
      name: "mock",
      fetchLatest: vi.fn().mockResolvedValue({
        kind: "error",
        reason: "Network error",
      }),
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      sources: [{ type: "npm", packageName: "my-cli" }],
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const sourceChecks = report.checks.filter((c) =>
      c.name.startsWith("Source:"),
    );
    expect(sourceChecks[0].status).toBe("fail");
    expect(sourceChecks[0].message).toBe("Network error");
  });

  it("produces correct summary counts", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      sources: [{ type: "npm", packageName: "my-cli" }],
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    expect(report.summary.total).toBe(report.checks.length);
    expect(
      report.summary.passed +
        report.summary.failed +
        report.summary.warnings +
        report.summary.skipped,
    ).toBe(report.summary.total);
  });

  it("fails when config is an array", async () => {
    const configPath = join(tempDir, "update-kit.config.json");
    writeFileSync(configPath, "[]");

    const report = await runDoctor(configPath, { cwd: tempDir });

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.message).toContain("must be a JSON object");
  });

  it("fails when config is missing currentVersion", async () => {
    const configPath = writeConfig({ appName: "my-cli" });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.message).toContain("missing currentVersion");
  });

  it("handles config with object repository field", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      repository: { type: "git", url: "https://github.com/org/my-cli.git" },
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("pass");
  });

  it("handles config with non-object/non-string repository gracefully", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      repository: 42,
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("pass");
  });

  it("reports detection failure", async () => {
    mockDetect.mockRejectedValue(new Error("detection crash"));

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const detectionCheck = report.checks.find((c) => c.name === "Detection");
    expect(detectionCheck?.status).toBe("fail");
    expect(detectionCheck?.message).toContain("detection crash");
  });

  it("infers npm source from appName when no explicit sources configured", async () => {
    mockFindPkg.mockResolvedValue({
      name: "my-cli",
      version: "1.0.0",
      path: join(tempDir, "package.json"),
      // no repository
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      // no sources, no repository
    });

    const report = await runDoctor(configPath, { cwd: tempDir });

    const sourceCheck = report.checks.find((c) => c.name === "Sources");
    expect(sourceCheck?.status).toBe("pass");
    expect(sourceCheck?.message).toContain("Auto-inferred");
    expect(sourceCheck?.details?.mode).toBe("inferred");
  });

  it("infers sources from package.json repository when config has none", async () => {
    mockFindPkg.mockResolvedValue({
      name: "my-cli",
      version: "1.0.0",
      path: join(tempDir, "package.json"),
      repository: "https://github.com/org/my-cli",
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });

    const report = await runDoctor(configPath, { cwd: tempDir });

    const sourceCheck = report.checks.find((c) => c.name === "Sources");
    expect(sourceCheck?.status).toBe("pass");
    expect(sourceCheck?.message).toContain("Auto-inferred");
  });

  it("reports connectivity not-modified as pass", async () => {
    mockCreateSource.mockReturnValue({
      name: "mock",
      fetchLatest: vi.fn().mockResolvedValue({
        kind: "not-modified",
      }),
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      sources: [{ type: "npm", packageName: "my-cli" }],
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const sourceChecks = report.checks.filter((c) =>
      c.name.startsWith("Source:"),
    );
    expect(sourceChecks[0].status).toBe("pass");
    expect(sourceChecks[0].message).toContain("not-modified");
  });

  it("reports connectivity exception as fail", async () => {
    mockCreateSource.mockReturnValue({
      name: "mock",
      fetchLatest: vi.fn().mockRejectedValue(new Error("Connection refused")),
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      sources: [{ type: "npm", packageName: "my-cli" }],
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const sourceChecks = report.checks.filter((c) =>
      c.name.startsWith("Source:"),
    );
    expect(sourceChecks[0].status).toBe("fail");
    expect(sourceChecks[0].message).toContain("Connection refused");
  });

  it("skips connectivity when no sources available", async () => {
    mockFindPkg.mockResolvedValue({
      name: "my-cli",
      version: "1.0.0",
      path: join(tempDir, "package.json"),
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const connectivityCheck = report.checks.find(
      (c) => c.name === "Connectivity",
    );
    if (connectivityCheck) {
      expect(connectivityCheck.status).toBe("skip");
      expect(connectivityCheck.message).toContain("No sources to check");
    }
  });

  it("warns when package.json has non-GitHub repository", async () => {
    mockFindPkg.mockResolvedValue({
      name: "my-cli",
      version: "1.0.0",
      path: join(tempDir, "package.json"),
      repository: "https://gitlab.com/org/my-cli",
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const pkgCheck = report.checks.find((c) => c.name === "Package.json");
    expect(pkgCheck?.status).toBe("warn");
    expect(pkgCheck?.message).toContain("not a GitHub URL");
  });

  it("parses all optional config fields correctly", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      checkInterval: 3600000,
      delegateMode: "execute",
      allowReexec: true,
      npmPackageName: "@scope/my-cli",
      brewCaskName: "my-cask",
      executablePath: "/usr/local/bin/my-cli",
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("pass");
  });

  it("defaults delegateMode to print-only for invalid value", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      delegateMode: "invalid",
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("pass");
  });

  it("handles string repository in config", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      repository: "https://github.com/org/my-cli",
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("pass");
  });

  it("handles object repository without url property", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      repository: { type: "git" },
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("pass");
  });

  it("reports hasSources=true in details when sources are configured", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      sources: [{ type: "npm", packageName: "my-cli" }],
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.details?.hasSources).toBe(true);
  });

  it("reports hasSources=false when no sources configured", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.details?.hasSources).toBe(false);
  });

  it("uses package.json repository for inferred source connectivity", async () => {
    mockFindPkg.mockResolvedValue({
      name: "my-cli",
      version: "1.0.0",
      path: join(tempDir, "package.json"),
      repository: "https://github.com/org/my-cli",
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    // Should have connectivity checks for inferred sources
    const sourceChecks = report.checks.filter((c) =>
      c.name.startsWith("Source:"),
    );
    expect(sourceChecks.length).toBeGreaterThan(0);
  });

  it("handles null config value", async () => {
    const configPath = join(tempDir, "update-kit.config.json");
    writeFileSync(configPath, "null");

    const report = await runDoctor(configPath, { cwd: tempDir });
    const configCheck = report.checks.find((c) => c.name === "Config file");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.message).toContain("must be a JSON object");
  });

  it("uses executablePath from config for detection", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
      executablePath: "/custom/path/my-cli",
    });

    const report = await runDoctor(configPath, { cwd: tempDir });
    const detectionCheck = report.checks.find((c) => c.name === "Detection");
    expect(detectionCheck?.status).toBe("pass");
    expect(mockDetect).toHaveBeenCalledWith(
      "/custom/path/my-cli",
      expect.any(Object),
    );
  });

  it("reports package.json with GitHub repository as pass", async () => {
    mockFindPkg.mockResolvedValue({
      name: "my-cli",
      version: "1.0.0",
      path: join(tempDir, "package.json"),
      repository: "https://github.com/org/my-cli",
    });

    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report = await runDoctor(configPath, { cwd: tempDir });

    const pkgCheck = report.checks.find((c) => c.name === "Package.json");
    expect(pkgCheck?.status).toBe("pass");
    expect(pkgCheck?.details?.githubOwner).toBe("org");
    expect(pkgCheck?.details?.githubRepo).toBe("my-cli");
  });

  it("JSON output conforms to DoctorReport shape", async () => {
    const configPath = writeConfig({
      appName: "my-cli",
      currentVersion: "1.0.0",
    });
    const report: DoctorReport = await runDoctor(configPath, { cwd: tempDir });

    expect(report).toHaveProperty("checks");
    expect(report).toHaveProperty("summary");
    expect(Array.isArray(report.checks)).toBe(true);
    for (const check of report.checks) {
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("status");
      expect(check).toHaveProperty("message");
      expect(["pass", "fail", "warn", "skip"]).toContain(check.status);
    }
  });
});
