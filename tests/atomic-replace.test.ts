import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  writeFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicReplace } from "../dist/index.mjs";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dist-replace-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("atomicReplace (Real I/O)", () => {
  let replaceDir: string;

  beforeEach(() => {
    replaceDir = mkdtempSync(join(tmpDir, "replace-"));
  });

  it("replaces target file with new content", async () => {
    const targetPath = join(replaceDir, "target.txt");
    const newPath = join(replaceDir, "new.txt");

    writeFileSync(targetPath, "old content");
    writeFileSync(newPath, "new content");

    await atomicReplace(newPath, targetPath);
    expect(readFileSync(targetPath, "utf-8")).toBe("new content");
  });

  it("target is readable after replacement", async () => {
    const targetPath = join(replaceDir, "target2.txt");
    const newPath = join(replaceDir, "new2.txt");

    writeFileSync(targetPath, "original");
    writeFileSync(newPath, "replacement");

    await atomicReplace(newPath, targetPath);
    expect(existsSync(targetPath)).toBe(true);
    expect(readFileSync(targetPath, "utf-8")).toBe("replacement");
  });

  it("throws when source file does not exist", async () => {
    const targetPath = join(replaceDir, "target3.txt");
    writeFileSync(targetPath, "content");

    await expect(
      atomicReplace(join(replaceDir, "nonexistent"), targetPath),
    ).rejects.toThrow();
  });
});
