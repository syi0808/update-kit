import type { Evidence } from "../types.js";

/** Known system path patterns and their hints */
const PATH_HINTS: Array<{ pattern: string; hint: string }> = [
  { pattern: "/usr/local/bin/", hint: "System local binary path" },
  { pattern: "/usr/bin/", hint: "System binary path" },
  { pattern: "/snap/", hint: "Snap package path" },
  { pattern: "/flatpak/", hint: "Flatpak package path" },
  { pattern: "/.local/bin/", hint: "User local binary path" },
  { pattern: "/AppData/", hint: "Windows AppData path" },
  { pattern: "/Applications/", hint: "macOS Applications path" },
];

/**
 * Collect path-based heuristic evidence from the exec path.
 * This function does not determine the channel on its own;
 * it provides auxiliary evidence for other detectors.
 */
export function collectPathHeuristics(execPath: string): Evidence[] {
  const evidence: Evidence[] = [];

  for (const { pattern, hint } of PATH_HINTS) {
    if (execPath.includes(pattern)) {
      evidence.push({
        source: "path_pattern",
        detail: hint,
      });
    }
  }

  return evidence;
}
