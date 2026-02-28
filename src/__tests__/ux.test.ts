import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApplyProgress,
  ApplyResult,
  InstallDetection,
  UpdateStatus,
} from "../types.js";
import { stripAnsi } from "../ux/colors.js";
import { runHook } from "../ux/hooks.js";
import { renderBanner, renderProgress, renderResult } from "../ux/index.js";

describe("UX 레이어", () => {
  const detection: InstallDetection = {
    channel: "npm-global",
    confidence: "high",
    evidence: [{ source: "path_pattern", detail: "installed via npm" }],
  };

  describe("renderBanner", () => {
    it("업데이트가 있을 때 배너 문자열을 반환한다", () => {
      const status: UpdateStatus = {
        kind: "available",
        current: "1.0.0",
        latest: "2.0.0",
      };
      const result = renderBanner(status, detection);
      expect(result).not.toBeNull();
      const plain = stripAnsi(result!);
      expect(plain).toContain("1.0.0");
      expect(plain).toContain("2.0.0");
    });

    it("업데이트가 없으면 null을 반환한다", () => {
      const status: UpdateStatus = { kind: "up-to-date", current: "2.0.0" };
      expect(renderBanner(status, detection)).toBeNull();
    });

    it("unknown 상태에서 null을 반환한다", () => {
      const status: UpdateStatus = { kind: "unknown", reason: "network error" };
      expect(renderBanner(status, detection)).toBeNull();
    });

    it("커스텀 템플릿을 적용할 수 있다", () => {
      const status: UpdateStatus = {
        kind: "available",
        current: "1.0.0",
        latest: "2.0.0",
      };
      const result = renderBanner(status, detection, {
        updateAvailable: ({ current, latest }) =>
          `새 버전 ${latest} (현재: ${current})`,
      });
      const plain = stripAnsi(result!);
      expect(plain).toContain("새 버전");
    });

    it("npm-global 채널에서 업데이트 명령어를 포함한다", () => {
      const status: UpdateStatus = {
        kind: "available",
        current: "1.0.0",
        latest: "2.0.0",
      };
      const result = renderBanner(status, detection);
      const plain = stripAnsi(result!);
      expect(plain).toContain("npm update -g");
    });

    it("brew-cask 채널에서 업데이트 명령어를 포함한다", () => {
      const status: UpdateStatus = {
        kind: "available",
        current: "1.0.0",
        latest: "2.0.0",
      };
      const brewDetection: InstallDetection = {
        channel: "brew-cask",
        confidence: "high",
        evidence: [{ source: "brew", detail: "installed via brew" }],
      };
      const result = renderBanner(status, brewDetection);
      const plain = stripAnsi(result!);
      expect(plain).toContain("brew upgrade --cask");
    });

    it("native 채널에서는 명령어를 포함하지 않는다", () => {
      const status: UpdateStatus = {
        kind: "available",
        current: "1.0.0",
        latest: "2.0.0",
      };
      const nativeDetection: InstallDetection = {
        channel: "native",
        confidence: "high",
        evidence: [{ source: "receipt", detail: "native install" }],
      };
      const result = renderBanner(status, nativeDetection);
      const plain = stripAnsi(result!);
      expect(plain).not.toContain("Run `");
    });
  });

  describe("ANSI 컬러", () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it("NO_COLOR 설정 시 ANSI 이스케이프가 포함되지 않는다", () => {
      process.env = { ...originalEnv, NO_COLOR: "1" };
      const status: UpdateStatus = {
        kind: "available",
        current: "1.0.0",
        latest: "2.0.0",
      };
      const result = renderBanner(status, detection);
      expect(result).not.toContain("\x1b[");
    });

    it("stripAnsi가 이스케이프 시퀀스를 제거한다", () => {
      const text = "\x1b[1mhello\x1b[0m \x1b[32mworld\x1b[0m";
      expect(stripAnsi(text)).toBe("hello world");
    });
  });

  describe("renderProgress", () => {
    it("다운로드 진행률을 퍼센트로 렌더링한다", () => {
      const progress: ApplyProgress = {
        phase: "downloading",
        bytesDownloaded: 500,
        totalBytes: 1000,
      };
      const text = renderProgress(progress);
      expect(text).toContain("50%");
    });

    it("totalBytes 없이 다운로드 진행을 렌더링한다", () => {
      const progress: ApplyProgress = {
        phase: "downloading",
        bytesDownloaded: 500,
      };
      const text = renderProgress(progress);
      expect(text).toContain("downloading");
      expect(text).not.toContain("%");
    });

    it("다른 phase를 렌더링한다", () => {
      const phases = ["verifying", "extracting", "replacing", "done"] as const;
      for (const phase of phases) {
        const progress = { phase } as ApplyProgress;
        const text = renderProgress(progress);
        expect(text).toContain(phase);
      }
    });
  });

  describe("renderResult", () => {
    it("성공 결과를 렌더링한다", () => {
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

    it("exit-after-apply 성공 결과를 렌더링한다", () => {
      const result: ApplyResult = {
        kind: "success",
        fromVersion: "1.0.0",
        toVersion: "2.0.0",
        postAction: "exit-after-apply",
      };
      const text = stripAnsi(renderResult(result));
      expect(text).toContain("exit");
    });

    it("none postAction 성공 결과를 렌더링한다", () => {
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

    it("needs-restart 결과를 렌더링한다", () => {
      const result: ApplyResult = {
        kind: "needs-restart",
        message: "Please restart to complete the update.",
      };
      const text = stripAnsi(renderResult(result));
      expect(text).toContain("restart");
    });

    it("실패 결과를 렌더링한다", () => {
      const result: ApplyResult = {
        kind: "failed",
        error: new Error("network timeout"),
        rollbackSucceeded: true,
      };
      const text = stripAnsi(renderResult(result));
      expect(text).toContain("network timeout");
    });
  });

  describe("runHook", () => {
    it("hooks가 undefined이면 true를 반환한다", async () => {
      const result = await runHook(undefined, "beforeCheck");
      expect(result).toBe(true);
    });

    it("특정 훅이 undefined이면 true를 반환한다", async () => {
      const result = await runHook({}, "beforeCheck");
      expect(result).toBe(true);
    });

    it("훅 함수를 올바른 인자로 호출한다", async () => {
      const beforeApply = vi.fn().mockReturnValue(true);
      const hooks = { beforeApply };
      const plan = {
        kind: {
          type: "native-in-place" as const,
          downloadUrl: "https://example.com/app.tar.gz",
        },
        fromVersion: "1.0.0",
        toVersion: "2.0.0",
        postAction: "none" as const,
      };
      await runHook(hooks, "beforeApply", plan);
      expect(beforeApply).toHaveBeenCalledWith(plan);
    });

    it("훅이 false를 반환하면 false를 반환한다", async () => {
      const hooks = { beforeCheck: () => false as boolean };
      const result = await runHook(hooks, "beforeCheck");
      expect(result).toBe(false);
    });

    it("비동기 훅을 처리한다", async () => {
      const hooks = { beforeCheck: async () => false as boolean };
      const result = await runHook(hooks, "beforeCheck");
      expect(result).toBe(false);
    });
  });
});
