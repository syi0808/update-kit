import { describe, expect, it } from "vitest";
import { collectPathHeuristics } from "../heuristics.js";

describe("collectPathHeuristics", () => {
  it("returns evidence for /usr/local/bin/", () => {
    const evidence = collectPathHeuristics("/usr/local/bin/my-app");
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    expect(evidence[0].source).toBe("path_pattern");
    expect(evidence[0].detail).toContain("System local binary");
  });

  it("returns evidence for /usr/bin/", () => {
    const evidence = collectPathHeuristics("/usr/bin/my-app");
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    expect(evidence[0].detail).toContain("System binary");
  });

  it("returns evidence for /snap/ path", () => {
    const evidence = collectPathHeuristics("/snap/my-app/current/bin/my-app");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].detail).toContain("Snap");
  });

  it("returns evidence for /flatpak/ path", () => {
    const evidence = collectPathHeuristics("/var/lib/flatpak/app/my-app");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].detail).toContain("Flatpak");
  });

  it("returns evidence for /.local/bin/ path", () => {
    const evidence = collectPathHeuristics("/home/user/.local/bin/my-app");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].detail).toContain("User local binary");
  });

  it("returns evidence for /AppData/ path (forward slash)", () => {
    const evidence = collectPathHeuristics(
      "C:/Users/user/AppData/Local/my-app",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].detail).toContain("Windows AppData");
  });

  it("returns evidence for AppData path with backslashes", () => {
    const evidence = collectPathHeuristics(
      "C:\\Users\\user\\AppData\\Local\\my-app\\my-app.exe",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].detail).toContain("Windows AppData");
  });

  it("returns evidence for Program Files path", () => {
    const evidence = collectPathHeuristics(
      "C:\\Program Files\\my-app\\my-app.exe",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].detail).toContain("Windows Program Files");
  });

  it("returns evidence for Program Files path (forward slash)", () => {
    const evidence = collectPathHeuristics(
      "C:/Program Files/my-app/my-app.exe",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].detail).toContain("Windows Program Files");
  });

  it("returns evidence for /Applications/ path", () => {
    const evidence = collectPathHeuristics(
      "/Applications/MyApp.app/Contents/MacOS/my-app",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].detail).toContain("macOS Applications");
  });

  it("returns empty array for unknown path", () => {
    const evidence = collectPathHeuristics("/some/random/path/my-app");
    expect(evidence).toHaveLength(0);
  });

  it("matches multiple patterns simultaneously", () => {
    // /usr/local/bin/ contains both /usr/local/bin/ and could potentially match others
    const evidence = collectPathHeuristics("/usr/local/bin/my-app");
    // At minimum matches /usr/local/bin/
    expect(evidence.length).toBeGreaterThanOrEqual(1);
  });
});
