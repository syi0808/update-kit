import { describe, it, expect } from "vitest";
import {
  UpdateKitError,
  DETECTION_FAILED,
  NETWORK_ERROR,
  CACHE_ERROR,
  VERSION_PARSE,
  CHECKSUM_MISMATCH,
  SIGNATURE_INVALID,
  PLAN_REJECTED,
  APPLY_FAILED,
  COMMAND_FAILED,
  UNSUPPORTED_PLATFORM,
  PERMISSION_DENIED,
  INSECURE_URL,
  DOWNLOAD_FAILED,
  CHECKSUM_MISSING,
  CHECKSUM_FETCH_FAILED,
  CHECKSUM_PARSE_FAILED,
  EXTRACT_FAILED,
  COMMAND_TIMEOUT,
  COMMAND_ABORTED,
  COMMAND_SPAWN_FAILED,
} from "../dist/index.mjs";

describe("UpdateKitError", () => {
  it("is an instance of Error", () => {
    const err = new UpdateKitError("TEST", "test message");
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of UpdateKitError", () => {
    const err = new UpdateKitError("TEST", "test message");
    expect(err).toBeInstanceOf(UpdateKitError);
  });

  it('has name "UpdateKitError"', () => {
    const err = new UpdateKitError("TEST", "test message");
    expect(err.name).toBe("UpdateKitError");
  });

  it("has correct code property", () => {
    const err = new UpdateKitError(NETWORK_ERROR, "failed");
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("has correct message", () => {
    const err = new UpdateKitError("TEST", "my error message");
    expect(err.message).toBe("my error message");
  });

  it("supports cause option", () => {
    const cause = new Error("root cause");
    const err = new UpdateKitError("TEST", "wrapper", { cause });
    expect(err.cause).toBe(cause);
  });

  it("preserves prototype chain in try/catch", () => {
    let caught = false;
    try {
      throw new UpdateKitError(CHECKSUM_MISMATCH, "bad checksum");
    } catch (e) {
      if (e instanceof UpdateKitError) {
        caught = true;
        expect(e.code).toBe("CHECKSUM_MISMATCH");
      }
    }
    expect(caught).toBe(true);
  });

  describe("all error code constants have correct string values", () => {
    const errorCodePairs: Array<[string, string]> = [
      [DETECTION_FAILED, "DETECTION_FAILED"],
      [NETWORK_ERROR, "NETWORK_ERROR"],
      [CACHE_ERROR, "CACHE_ERROR"],
      [VERSION_PARSE, "VERSION_PARSE"],
      [CHECKSUM_MISMATCH, "CHECKSUM_MISMATCH"],
      [SIGNATURE_INVALID, "SIGNATURE_INVALID"],
      [PLAN_REJECTED, "PLAN_REJECTED"],
      [APPLY_FAILED, "APPLY_FAILED"],
      [COMMAND_FAILED, "COMMAND_FAILED"],
      [UNSUPPORTED_PLATFORM, "UNSUPPORTED_PLATFORM"],
      [PERMISSION_DENIED, "PERMISSION_DENIED"],
      [INSECURE_URL, "INSECURE_URL"],
      [DOWNLOAD_FAILED, "DOWNLOAD_FAILED"],
      [CHECKSUM_MISSING, "CHECKSUM_MISSING"],
      [CHECKSUM_FETCH_FAILED, "CHECKSUM_FETCH_FAILED"],
      [CHECKSUM_PARSE_FAILED, "CHECKSUM_PARSE_FAILED"],
      [EXTRACT_FAILED, "EXTRACT_FAILED"],
      [COMMAND_TIMEOUT, "COMMAND_TIMEOUT"],
      [COMMAND_ABORTED, "COMMAND_ABORTED"],
      [COMMAND_SPAWN_FAILED, "COMMAND_SPAWN_FAILED"],
    ];

    it.each(errorCodePairs)('"%s" equals "%s"', (constant, expected) => {
      expect(constant).toBe(expected);
    });

    it("there are exactly 20 error codes", () => {
      expect(errorCodePairs).toHaveLength(20);
    });
  });
});
