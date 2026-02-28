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
