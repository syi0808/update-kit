import { describe, it, expect } from "vitest";

describe("E2E setup smoke test", () => {
  it("can import UpdateKit from dist", async () => {
    const mod = await import("../../../dist/index.mjs");
    expect(mod.UpdateKit).toBeDefined();
  });
});
