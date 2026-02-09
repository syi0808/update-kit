import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApplyResult } from "../dist/index.mjs";
import { renderResult, stripAnsi } from "../dist/index.mjs";

let savedNoColor: string | undefined;

beforeAll(() => {
  savedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});

afterAll(() => {
  if (savedNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = savedNoColor;
  }
});

describe("renderResult", () => {
  it("renders success with suggest-restart", () => {
    const result: ApplyResult = {
      kind: "success",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "suggest-restart",
    };
    const text = stripAnsi(renderResult(result));
    expect(text).toContain("2.0.0");
    expect(text).toContain("restart");
  });

  it("renders success with exit-after-apply", () => {
    const result: ApplyResult = {
      kind: "success",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "exit-after-apply",
    };
    const text = stripAnsi(renderResult(result));
    expect(text).toContain("exit");
  });

  it("renders success with none postAction", () => {
    const result: ApplyResult = {
      kind: "success",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "none",
    };
    const text = stripAnsi(renderResult(result));
    expect(text).toContain("2.0.0");
    expect(text).not.toContain("restart");
    expect(text).not.toContain("exit");
  });

  it("renders success with reexec postAction", () => {
    const result: ApplyResult = {
      kind: "success",
      fromVersion: "1.0.0",
      toVersion: "3.0.0",
      postAction: "reexec",
    };
    const text = stripAnsi(renderResult(result));
    expect(text).toContain("3.0.0");
  });

  it("renders needs-restart result", () => {
    const result: ApplyResult = {
      kind: "needs-restart",
      message: "Please restart the application.",
    };
    const text = stripAnsi(renderResult(result));
    expect(text).toContain("Please restart the application.");
  });

  it("renders failed result with error message", () => {
    const result: ApplyResult = {
      kind: "failed",
      error: new Error("network timeout"),
      rollbackSucceeded: true,
    };
    const text = stripAnsi(renderResult(result));
    expect(text).toContain("network timeout");
  });

  it("renders failed result with long error message", () => {
    const longMessage =
      "Failed to download the update because the server returned HTTP 503 Service Unavailable";
    const result: ApplyResult = {
      kind: "failed",
      error: new Error(longMessage),
      rollbackSucceeded: false,
    };
    const text = stripAnsi(renderResult(result));
    expect(text).toContain(longMessage);
  });
});
