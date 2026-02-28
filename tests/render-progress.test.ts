import { describe, expect, it } from "vitest";
import type { ApplyProgress } from "../dist/index.mjs";
import { renderProgress } from "../dist/index.mjs";

describe("renderProgress", () => {
  it("downloading with totalBytes shows 50% progress", () => {
    const progress: ApplyProgress = {
      phase: "downloading",
      bytesDownloaded: 500,
      totalBytes: 1000,
    };
    expect(renderProgress(progress)).toContain("50%");
  });

  it("downloading with 0 bytes shows 0% progress", () => {
    const progress: ApplyProgress = {
      phase: "downloading",
      bytesDownloaded: 0,
      totalBytes: 1000,
    };
    expect(renderProgress(progress)).toContain("0%");
  });

  it("downloading at 100% shows 100%", () => {
    const progress: ApplyProgress = {
      phase: "downloading",
      bytesDownloaded: 1000,
      totalBytes: 1000,
    };
    expect(renderProgress(progress)).toContain("100%");
  });

  it("downloading without totalBytes shows no percentage", () => {
    const progress: ApplyProgress = {
      phase: "downloading",
      bytesDownloaded: 500,
    };
    const text = renderProgress(progress);
    expect(text).toContain("downloading");
    expect(text).not.toContain("%");
  });

  it.each([
    "verifying",
    "extracting",
    "replacing",
    "done",
  ] as const)("renders %s phase", (phase) => {
    const progress = { phase } as ApplyProgress;
    const text = renderProgress(progress);
    expect(text).toContain(phase);
  });
});
