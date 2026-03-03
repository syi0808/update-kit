import { describe, expectTypeOf, it } from "vitest";
import type { Channel, UpdateStatus } from "../index.js";
import { NETWORK_ERROR, UpdateKitError } from "../index.js";

describe("core types", () => {
  it("Channel type accepts known channels and custom strings", () => {
    const native: Channel = "native";
    const custom: Channel = "my-custom-channel";
    expectTypeOf(native).toMatchTypeOf<Channel>();
    expectTypeOf(custom).toMatchTypeOf<Channel>();
  });

  it("UpdateStatus is a discriminated union", () => {
    const status: UpdateStatus = {
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    };
    if (status.kind === "available") {
      expectTypeOf(status.latest).toBeString();
    }
  });

  it("UpdateKitError has a code field", () => {
    const err = new UpdateKitError(NETWORK_ERROR, "request failed");
    expectTypeOf(err.code).toBeString();
    expectTypeOf(err).toMatchTypeOf<Error>();
  });
});
