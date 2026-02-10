import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderBanner, stripAnsi } from "../dist/index.mjs";
import type { UpdateStatus, InstallDetection } from "../dist/index.mjs";

let savedNoColor: string | undefined;

beforeAll(() => {
  savedNoColor = process.env["NO_COLOR"];
  process.env["NO_COLOR"] = "1";
});

afterAll(() => {
  if (savedNoColor === undefined) {
    delete process.env["NO_COLOR"];
  } else {
    process.env["NO_COLOR"] = savedNoColor;
  }
});

describe("renderBanner", () => {
  const npmDetection: InstallDetection = {
    channel: "npm-global",
    confidence: "high",
    evidence: [{ source: "path_pattern", detail: "installed via npm" }],
  };

  const brewDetection: InstallDetection = {
    channel: "brew-cask",
    confidence: "high",
    evidence: [{ source: "brew", detail: "installed via brew" }],
  };

  const nativeDetection: InstallDetection = {
    channel: "native",
    confidence: "high",
    evidence: [{ source: "receipt", detail: "native install" }],
  };

  const availableStatus: UpdateStatus = {
    kind: "available",
    current: "1.0.0",
    latest: "2.0.0",
  };

  it("returns null when status is up-to-date", () => {
    const status: UpdateStatus = { kind: "up-to-date", current: "2.0.0" };
    expect(renderBanner(status, npmDetection)).toBeNull();
  });

  it("returns null when status is unknown", () => {
    const status: UpdateStatus = { kind: "unknown", reason: "network error" };
    expect(renderBanner(status, npmDetection)).toBeNull();
  });

  it("returns banner string when update is available", () => {
    const result = renderBanner(availableStatus, nativeDetection);
    expect(result).not.toBeNull();
    const plain = stripAnsi(result!);
    expect(plain).toContain("1.0.0");
    expect(plain).toContain("2.0.0");
  });

  it("npm-global channel includes npm update command", () => {
    const result = renderBanner(availableStatus, npmDetection);
    const plain = stripAnsi(result!);
    expect(plain).toContain("npm update -g");
  });

  it("brew-cask channel includes brew upgrade command", () => {
    const result = renderBanner(availableStatus, brewDetection);
    const plain = stripAnsi(result!);
    expect(plain).toContain("brew upgrade --cask");
  });

  it("native channel does not include a command", () => {
    const result = renderBanner(availableStatus, nativeDetection);
    const plain = stripAnsi(result!);
    expect(plain).not.toContain("Run `");
  });

  it("unmanaged channel does not include a command", () => {
    const unmanagedDetection: InstallDetection = {
      channel: "unmanaged",
      confidence: "medium",
      evidence: [],
    };
    const result = renderBanner(availableStatus, unmanagedDetection);
    const plain = stripAnsi(result!);
    expect(plain).not.toContain("Run `");
  });

  it("custom channel does not include a command", () => {
    const customDetection: InstallDetection = {
      channel: "my-custom-channel",
      confidence: "high",
      evidence: [],
    };
    const result = renderBanner(availableStatus, customDetection);
    const plain = stripAnsi(result!);
    expect(plain).not.toContain("Run `");
  });

  it("accepts custom template overrides", () => {
    const result = renderBanner(availableStatus, nativeDetection, {
      updateAvailable: ({ current, latest }) =>
        `New version ${latest} (current: ${current})`,
    });
    const plain = stripAnsi(result!);
    expect(plain).toContain("New version");
  });
});
