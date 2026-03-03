import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDefaultCacheDir, getDefaultConfigDir } from "../paths.js";

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.XDG_CACHE_HOME;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.LOCALAPPDATA;
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  process.env = { ...originalEnv };
});

describe("getDefaultCacheDir", () => {
  it("returns XDG_CACHE_HOME when set on Unix", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.XDG_CACHE_HOME = "/custom/cache";

    expect(getDefaultCacheDir()).toBe("/custom/cache");
  });

  it("falls back to ~/.cache on Unix when XDG not set", () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    expect(getDefaultCacheDir()).toBe(path.join(os.homedir(), ".cache"));
  });

  it("works on macOS (darwin)", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    expect(getDefaultCacheDir()).toBe(path.join(os.homedir(), ".cache"));
  });

  it("returns LOCALAPPDATA on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";

    expect(getDefaultCacheDir()).toBe("C:\\Users\\test\\AppData\\Local");
  });

  it("falls back to ~/AppData/Local on Windows when LOCALAPPDATA not set", () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    expect(getDefaultCacheDir()).toBe(
      path.join(os.homedir(), "AppData", "Local"),
    );
  });
});

describe("getDefaultConfigDir", () => {
  it("returns XDG_CONFIG_HOME when set on Unix", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.XDG_CONFIG_HOME = "/custom/config";

    expect(getDefaultConfigDir()).toBe("/custom/config");
  });

  it("falls back to ~/.config on Unix when XDG not set", () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    expect(getDefaultConfigDir()).toBe(path.join(os.homedir(), ".config"));
  });

  it("returns LOCALAPPDATA on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";

    expect(getDefaultConfigDir()).toBe("C:\\Users\\test\\AppData\\Local");
  });

  it("falls back to ~/AppData/Local on Windows when LOCALAPPDATA not set", () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    expect(getDefaultConfigDir()).toBe(
      path.join(os.homedir(), "AppData", "Local"),
    );
  });
});
