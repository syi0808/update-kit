import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bold,
  dim,
  green,
  red,
  stripAnsi,
  supportsColor,
  yellow,
} from "../dist/index.mjs";

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

describe("Color Functions & stripAnsi", () => {
  describe("with NO_COLOR set", () => {
    it("supportsColor() returns false", () => {
      expect(supportsColor()).toBe(false);
    });

    it("bold returns plain text", () => {
      expect(bold("hello")).toBe("hello");
    });

    it("red returns plain text", () => {
      expect(red("hello")).toBe("hello");
    });

    it("green returns plain text", () => {
      expect(green("hello")).toBe("hello");
    });

    it("yellow returns plain text", () => {
      expect(yellow("hello")).toBe("hello");
    });

    it("dim returns plain text", () => {
      expect(dim("hello")).toBe("hello");
    });
  });

  describe("stripAnsi", () => {
    it("removes bold escape sequences", () => {
      expect(stripAnsi("\x1b[1mhello\x1b[0m")).toBe("hello");
    });

    it("removes red escape sequences", () => {
      expect(stripAnsi("\x1b[31merror\x1b[0m")).toBe("error");
    });

    it("handles plain text without ANSI", () => {
      expect(stripAnsi("no ansi")).toBe("no ansi");
    });

    it("handles empty string", () => {
      expect(stripAnsi("")).toBe("");
    });

    it("handles nested ANSI sequences", () => {
      expect(stripAnsi("\x1b[1m\x1b[31mbold red\x1b[0m\x1b[0m")).toBe(
        "bold red",
      );
    });

    it("handles multiple separate ANSI segments", () => {
      expect(stripAnsi("\x1b[32mgreen\x1b[0m and \x1b[33myellow\x1b[0m")).toBe(
        "green and yellow",
      );
    });
  });

  describe("color functions with empty strings", () => {
    it("bold with empty string", () => {
      expect(bold("")).toBe("");
    });

    it("red with empty string", () => {
      expect(red("")).toBe("");
    });

    it("green with empty string", () => {
      expect(green("")).toBe("");
    });

    it("yellow with empty string", () => {
      expect(yellow("")).toBe("");
    });

    it("dim with empty string", () => {
      expect(dim("")).toBe("");
    });
  });
});
