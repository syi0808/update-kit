import { lstat, readlink } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectFromNpm } from "../npm.js";

vi.mock("node:fs/promises", () => ({
  lstat: vi.fn(() => Promise.reject(new Error("ENOENT"))),
  readlink: vi.fn(() => Promise.reject(new Error("ENOENT"))),
}));

// vi.hoisted runs before vi.mock hoisting, so it's safe to reference in factory
const { execFilePromisified } = vi.hoisted(() => ({
  execFilePromisified: vi.fn<[], Promise<{ stdout: string; stderr: string }>>(
    () => Promise.reject(new Error("mock: command not found")),
  ),
}));

vi.mock("node:child_process", () => {
  const fn: ReturnType<typeof vi.fn> & { [key: symbol]: unknown } = vi.fn();
  fn[Symbol.for("nodejs.util.promisify.custom")] = execFilePromisified;
  return { execFile: fn };
});

describe("detectFromNpm", () => {
  beforeEach(() => {
    vi.mocked(lstat).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(readlink).mockRejectedValue(new Error("ENOENT"));
    execFilePromisified.mockRejectedValue(new Error("mock: command not found"));
  });

  it("returns npm-global for node_modules/.bin/ path", async () => {
    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/.bin/my-app",
    );
    expect(result).not.toBeNull();
    expect(result?.channel).toBe("npm-global");
    expect(result?.evidence[0].source).toBe("path_pattern");
  });

  it("returns npm-global for /lib/node_modules/ path", async () => {
    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/my-app/bin/cli.js",
    );
    expect(result).not.toBeNull();
    expect(result?.channel).toBe("npm-global");
  });

  it("adds npm_prefix evidence when npm prefix -g matches", async () => {
    execFilePromisified.mockResolvedValueOnce({
      stdout: "/usr/local\n",
      stderr: "",
    });

    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/.bin/my-app",
    );
    expect(result).not.toBeNull();
    const npmPrefixEvidence = result?.evidence.find(
      (e) => e.source === "npm_prefix",
    );
    expect(npmPrefixEvidence).toBeDefined();
  });

  it("adds symlink evidence when target includes node_modules", async () => {
    vi.mocked(lstat).mockResolvedValueOnce({
      isSymbolicLink: () => true,
    } as unknown as Awaited<ReturnType<typeof lstat>>);
    vi.mocked(readlink).mockResolvedValueOnce(
      "/usr/local/lib/node_modules/my-app/bin/cli.js",
    );

    const result = await detectFromNpm("/usr/local/bin/my-app");
    expect(result).not.toBeNull();
    const symlinkEvidence = result?.evidence.find(
      (e) => e.source === "symlink",
    );
    expect(symlinkEvidence).toBeDefined();
  });

  it("returns high confidence with 2+ evidence items", async () => {
    execFilePromisified.mockResolvedValueOnce({
      stdout: "/usr/local\n",
      stderr: "",
    });

    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/.bin/my-app",
    );
    expect(result?.confidence).toBe("high");
    expect(result?.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("returns medium confidence with 1 evidence item", async () => {
    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/.bin/my-app",
    );
    expect(result?.confidence).toBe("medium");
    expect(result?.evidence).toHaveLength(1);
  });

  it("returns null for non-npm path", async () => {
    const result = await detectFromNpm("/usr/local/bin/my-app");
    expect(result).toBeNull();
  });

  it("ignores npm prefix -g failure", async () => {
    const result = await detectFromNpm("/some/random/path/my-app");
    expect(result).toBeNull();
  });

  it("ignores symlink check failure", async () => {
    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/.bin/my-app",
    );
    expect(result).not.toBeNull();
  });

  it("returns npm-global for Windows backslash node_modules/.bin path", async () => {
    const result = await detectFromNpm(
      "C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\.bin\\my-app",
    );
    expect(result).not.toBeNull();
    expect(result?.channel).toBe("npm-global");
    expect(result?.evidence[0].source).toBe("path_pattern");
  });

  it("returns npm-global for Windows backslash lib/node_modules path", async () => {
    const result = await detectFromNpm(
      "C:\\Users\\user\\AppData\\Roaming\\npm\\lib\\node_modules\\my-app\\bin\\cli.js",
    );
    expect(result).not.toBeNull();
    expect(result?.channel).toBe("npm-global");
  });

  it("adds npm_prefix evidence with Windows backslash prefix", async () => {
    execFilePromisified.mockResolvedValueOnce({
      stdout: "C:\\Users\\user\\AppData\\Roaming\\npm\n",
      stderr: "",
    });

    const result = await detectFromNpm(
      "C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\.bin\\my-app",
    );
    expect(result).not.toBeNull();
    const npmPrefixEvidence = result?.evidence.find(
      (e) => e.source === "npm_prefix",
    );
    expect(npmPrefixEvidence).toBeDefined();
  });

  it("returns null for Windows non-npm path", async () => {
    const result = await detectFromNpm("C:\\Program Files\\my-app\\my-app.exe");
    expect(result).toBeNull();
  });

  it("does not add npm_prefix evidence when prefix does not match", async () => {
    execFilePromisified.mockResolvedValueOnce({
      stdout: "/home/other/.nvm/versions/node/v20/\n",
      stderr: "",
    });

    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/.bin/my-app",
    );
    expect(result).not.toBeNull();
    // Only path_pattern evidence, not npm_prefix
    const npmPrefixEvidence = result?.evidence.find(
      (e) => e.source === "npm_prefix",
    );
    expect(npmPrefixEvidence).toBeUndefined();
    expect(result?.confidence).toBe("medium");
  });

  it("does not add symlink evidence when symlink target does not include node_modules", async () => {
    vi.mocked(lstat).mockResolvedValueOnce({
      isSymbolicLink: () => true,
    } as unknown as Awaited<ReturnType<typeof lstat>>);
    vi.mocked(readlink).mockResolvedValueOnce("/opt/my-app/bin/cli.js");

    // Use a path that matches npm pattern so we get at least one evidence
    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/.bin/my-app",
    );
    expect(result).not.toBeNull();
    const symlinkEvidence = result?.evidence.find(
      (e) => e.source === "symlink",
    );
    expect(symlinkEvidence).toBeUndefined();
  });

  it("does not add symlink evidence when file is not a symlink", async () => {
    vi.mocked(lstat).mockResolvedValueOnce({
      isSymbolicLink: () => false,
    } as unknown as Awaited<ReturnType<typeof lstat>>);

    const result = await detectFromNpm(
      "/usr/local/lib/node_modules/.bin/my-app",
    );
    expect(result).not.toBeNull();
    const symlinkEvidence = result?.evidence.find(
      (e) => e.source === "symlink",
    );
    expect(symlinkEvidence).toBeUndefined();
  });
});
