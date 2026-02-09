import { describe, expect, it } from "vitest";
import { normalizeVersion } from "../dist/index.mjs";

describe("normalizeVersion", () => {
  describe("standard semver strings", () => {
    it('parses "1.0.0"', () => {
      expect(normalizeVersion("1.0.0")).toBe("1.0.0");
    });

    it('parses "0.0.1"', () => {
      expect(normalizeVersion("0.0.1")).toBe("0.0.1");
    });

    it('parses "10.20.30"', () => {
      expect(normalizeVersion("10.20.30")).toBe("10.20.30");
    });

    it('parses "0.0.0"', () => {
      expect(normalizeVersion("0.0.0")).toBe("0.0.0");
    });

    it('parses "999.999.999"', () => {
      expect(normalizeVersion("999.999.999")).toBe("999.999.999");
    });
  });

  describe("v prefix", () => {
    it('strips v prefix from "v1.0.0"', () => {
      expect(normalizeVersion("v1.0.0")).toBe("1.0.0");
    });

    it('strips v prefix from "v2.3.4"', () => {
      expect(normalizeVersion("v2.3.4")).toBe("2.3.4");
    });
  });

  describe("pre-release tags are stripped", () => {
    it("strips alpha tag", () => {
      expect(normalizeVersion("1.0.0-alpha.1")).toBe("1.0.0");
    });

    it("strips beta tag", () => {
      expect(normalizeVersion("2.0.0-beta.3")).toBe("2.0.0");
    });

    it("strips rc tag", () => {
      expect(normalizeVersion("1.0.0-rc.1")).toBe("1.0.0");
    });
  });

  describe("build metadata is stripped", () => {
    it("strips build metadata", () => {
      expect(normalizeVersion("1.0.0+build.123")).toBe("1.0.0");
    });

    it("strips both pre-release and build metadata", () => {
      expect(normalizeVersion("1.0.0-alpha+build")).toBe("1.0.0");
    });
  });

  describe("partial version coercion", () => {
    it('coerces "1" to "1.0.0"', () => {
      expect(normalizeVersion("1")).toBe("1.0.0");
    });

    it('coerces "1.2" to "1.2.0"', () => {
      expect(normalizeVersion("1.2")).toBe("1.2.0");
    });
  });

  describe("invalid versions return null", () => {
    it("returns null for empty string", () => {
      expect(normalizeVersion("")).toBeNull();
    });

    it('returns null for "not-a-version"', () => {
      expect(normalizeVersion("not-a-version")).toBeNull();
    });

    it('returns null for "..."', () => {
      expect(normalizeVersion("...")).toBeNull();
    });

    it("returns null for pure text", () => {
      expect(normalizeVersion("abc")).toBeNull();
    });
  });
});
