import os from "node:os";
import path from "node:path";

/**
 * Return the default cache directory for the current platform.
 * - Unix: $XDG_CACHE_HOME or ~/.cache
 * - Windows: %LOCALAPPDATA% or ~/AppData/Local
 */
export function getDefaultCacheDir(): string {
  if (process.platform === "win32") {
    return (
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
    );
  }

  return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
}

/**
 * Return the default config directory for the current platform.
 * - Unix: $XDG_CONFIG_HOME or ~/.config
 * - Windows: %LOCALAPPDATA% or ~/AppData/Local
 */
export function getDefaultConfigDir(): string {
  if (process.platform === "win32") {
    return (
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
    );
  }

  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}
