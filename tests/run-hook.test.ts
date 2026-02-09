import { describe, expect, it, vi } from "vitest";
import type { ApplyResult, UpdatePlan } from "../dist/index.mjs";
import { NETWORK_ERROR, runHook, UpdateKitError } from "../dist/index.mjs";

describe("runHook", () => {
  it("returns true when hooks object is undefined", async () => {
    const result = await runHook(undefined, "beforeCheck");
    expect(result).toBe(true);
  });

  it("returns true when specific hook is undefined", async () => {
    const result = await runHook({}, "beforeCheck");
    expect(result).toBe(true);
  });

  it("returns false when hook returns false", async () => {
    const hooks = { beforeCheck: () => false as boolean };
    const result = await runHook(hooks, "beforeCheck");
    expect(result).toBe(false);
  });

  it("returns true when hook returns true", async () => {
    const hooks = { beforeCheck: () => true as boolean };
    const result = await runHook(hooks, "beforeCheck");
    expect(result).toBe(true);
  });

  it("handles async hooks", async () => {
    const hooks = { beforeCheck: async () => false as boolean };
    const result = await runHook(hooks, "beforeCheck");
    expect(result).toBe(false);
  });

  it("passes arguments to beforeApply hook", async () => {
    const beforeApply = vi.fn().mockReturnValue(true);
    const hooks = { beforeApply };
    const plan: UpdatePlan = {
      kind: {
        type: "native-in-place",
        downloadUrl: "https://example.com/app.tar.gz",
      },
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "none",
    };
    await runHook(hooks, "beforeApply", plan);
    expect(beforeApply).toHaveBeenCalledWith(plan);
  });

  it("passes arguments to afterApply hook", async () => {
    const afterApply = vi.fn();
    const hooks = { afterApply };
    const result: ApplyResult = {
      kind: "success",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      postAction: "none",
    };
    await runHook(hooks, "afterApply", result);
    expect(afterApply).toHaveBeenCalledWith(result);
  });

  it("passes arguments to onError hook", async () => {
    const onError = vi.fn();
    const hooks = { onError };
    const error = new UpdateKitError(NETWORK_ERROR, "timeout");
    await runHook(hooks, "onError", error);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
