import { describe, it, expect } from "vitest";
import { defaultTemplates } from "../dist/index.mjs";

describe("defaultTemplates", () => {
  it("updateAvailable without command", () => {
    const text = defaultTemplates.updateAvailable({
      current: "1.0.0",
      latest: "2.0.0",
    });
    expect(text).toBe("Update available: 1.0.0 → 2.0.0");
  });

  it("updateAvailable with command", () => {
    const text = defaultTemplates.updateAvailable({
      current: "1.0.0",
      latest: "2.0.0",
      command: "npm update -g foo",
    });
    expect(text).toContain("Run `npm update -g foo` to update.");
  });

  it("updateInProgress without progress", () => {
    const text = defaultTemplates.updateInProgress({ phase: "downloading" });
    expect(text).toBe("Updating... downloading");
  });

  it("updateInProgress with progress percentage", () => {
    const text = defaultTemplates.updateInProgress({
      phase: "downloading",
      progress: 0.5,
    });
    expect(text).toContain("50%");
  });

  it("updateInProgress with 0% progress", () => {
    const text = defaultTemplates.updateInProgress({
      phase: "downloading",
      progress: 0,
    });
    expect(text).toContain("0%");
  });

  it("updateInProgress with 100% progress", () => {
    const text = defaultTemplates.updateInProgress({
      phase: "downloading",
      progress: 1,
    });
    expect(text).toContain("100%");
  });

  it("updateSuccess with suggest-restart", () => {
    const text = defaultTemplates.updateSuccess({
      version: "2.0.0",
      postAction: "suggest-restart",
    });
    expect(text).toContain("2.0.0");
    expect(text).toContain("restart");
  });

  it("updateSuccess with exit-after-apply", () => {
    const text = defaultTemplates.updateSuccess({
      version: "2.0.0",
      postAction: "exit-after-apply",
    });
    expect(text).toContain("exit");
  });

  it("updateSuccess with none postAction", () => {
    const text = defaultTemplates.updateSuccess({
      version: "2.0.0",
      postAction: "none",
    });
    expect(text).toBe("Updated to 2.0.0.");
  });

  it("updateFailed includes error", () => {
    const text = defaultTemplates.updateFailed({ error: "disk full" });
    expect(text).toBe("Update failed: disk full");
  });

  it("manualInstruction without downloadUrl", () => {
    const text = defaultTemplates.manualInstruction({
      instructions: "Download from website",
    });
    expect(text).toBe("Download from website");
  });

  it("manualInstruction with downloadUrl", () => {
    const text = defaultTemplates.manualInstruction({
      instructions: "Install manually",
      downloadUrl: "https://example.com/dl",
    });
    expect(text).toContain("Download: https://example.com/dl");
  });
});
