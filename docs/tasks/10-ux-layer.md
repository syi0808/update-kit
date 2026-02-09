# Task 10: UX 레이어

## 목표

메시지 템플릿, 배너 포맷팅, ANSI 컬러 지원, 그리고 라이프사이클 훅 통합을 구현한다. 사용자에게 업데이트 상태를 시각적으로 전달하는 UX 계층을 구축하며, TTY/non-TTY 환경과 `NO_COLOR` 설정에 따라 출력을 자동으로 조정한다.

## 선행 태스크

- Task 02: 핵심 타입 정의

## 구현 상세

### 1. src/ux/templates.ts - 기본 메시지 템플릿

업데이트 흐름의 각 단계에서 사용할 메시지 템플릿 인터페이스와 기본 구현을 정의한다.

```typescript
import type { PostAction } from '../types.js';

/**
 * 메시지 템플릿 인터페이스.
 * 각 함수는 컨텍스트 객체를 받아 사용자에게 표시할 문자열을 반환한다.
 */
export interface MessageTemplates {
  updateAvailable: (ctx: { current: string; latest: string; command?: string }) => string;
  updateInProgress: (ctx: { phase: string; progress?: number }) => string;
  updateSuccess: (ctx: { version: string; postAction: PostAction }) => string;
  updateFailed: (ctx: { error: string }) => string;
  manualInstruction: (ctx: { instructions: string; downloadUrl?: string }) => string;
}
```

기본 템플릿 구현 예시:

```typescript
export const defaultTemplates: MessageTemplates = {
  updateAvailable({ current, latest, command }) {
    const base = `Update available: ${current} → ${latest}`;
    return command ? `${base}\n  Run \`${command}\` to update.` : base;
  },

  updateInProgress({ phase, progress }) {
    const pct = progress != null ? ` (${Math.round(progress * 100)}%)` : '';
    return `Updating... ${phase}${pct}`;
  },

  updateSuccess({ version, postAction }) {
    const base = `Updated to ${version}.`;
    if (postAction === 'suggest-restart') {
      return `${base} Please restart the application.`;
    }
    if (postAction === 'exit-after-apply') {
      return `${base} The application will now exit.`;
    }
    return base;
  },

  updateFailed({ error }) {
    return `Update failed: ${error}`;
  },

  manualInstruction({ instructions, downloadUrl }) {
    const base = instructions;
    return downloadUrl ? `${base}\n  Download: ${downloadUrl}` : base;
  },
};
```

### 2. src/ux/colors.ts - ANSI 컬러 유틸리티

외부 의존성 없이 직접 ANSI 이스케이프 코드를 사용한다. `NO_COLOR` 환경 변수와 `process.stdout.isTTY` 상태에 따라 자동으로 컬러 출력을 비활성화한다.

```typescript
/**
 * 컬러 출력 가능 여부를 판정한다.
 * NO_COLOR 환경 변수가 설정되어 있거나 stdout이 TTY가 아닌 경우 false를 반환한다.
 */
export function supportsColor(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  return process.stdout.isTTY === true;
}

// ANSI 이스케이프 코드 헬퍼
const ESC = '\x1b[';

function wrap(code: string, text: string): string {
  return supportsColor() ? `${ESC}${code}m${text}${ESC}0m` : text;
}

export const bold   = (text: string) => wrap('1', text);
export const red    = (text: string) => wrap('31', text);
export const green  = (text: string) => wrap('32', text);
export const yellow = (text: string) => wrap('33', text);
export const dim    = (text: string) => wrap('2', text);

/**
 * ANSI 이스케이프 시퀀스를 모두 제거한다.
 * 테스트에서 순수 텍스트 비교에 유용하다.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[\d+m/g, '');
}
```

ANSI 컬러 전략:
- **Bold**: 버전 번호 강조
- **Yellow**: 경고 메시지
- **Green**: 성공 메시지
- **Red**: 에러 메시지
- **Dim**: 부가 정보 (URL 등)

### 3. src/ux/index.ts - 렌더링 함수

메시지 템플릿과 컬러 유틸리티를 결합하여 최종 출력 문자열을 생성하는 함수를 제공한다.

```typescript
import type { UpdateStatus, InstallDetection, ApplyProgress, ApplyResult } from '../types.js';
import type { MessageTemplates } from './templates.js';
import { defaultTemplates } from './templates.js';
import { bold, green, yellow, red, dim } from './colors.js';

/**
 * 업데이트 상태를 기반으로 배너 문자열을 생성한다.
 * 업데이트가 없으면 null을 반환한다.
 * TTY 환경이면 ANSI 컬러를 적용하고, 아니면 플레인 텍스트를 반환한다.
 */
export function renderBanner(
  status: UpdateStatus,
  detection: InstallDetection,
  config?: Partial<MessageTemplates>,
): string | null {
  if (status.kind !== 'available') return null;

  const templates = { ...defaultTemplates, ...config };
  const command = resolveUpdateCommand(detection);

  const message = templates.updateAvailable({
    current: status.current,
    latest: status.latest,
    command,
  });

  // 컬러 적용: 버전 번호를 bold로 감싼다
  return message
    .replace(status.current, bold(status.current))
    .replace(status.latest, bold(green(status.latest)));
}

/**
 * 적용 진행 상황을 렌더링한다.
 */
export function renderProgress(progress: ApplyProgress): string {
  const templates = defaultTemplates;
  if (progress.phase === 'downloading') {
    const pct = progress.totalBytes
      ? progress.bytesDownloaded / progress.totalBytes
      : undefined;
    return templates.updateInProgress({ phase: 'downloading', progress: pct });
  }
  return templates.updateInProgress({ phase: progress.phase });
}

/**
 * 적용 결과를 렌더링한다.
 */
export function renderResult(result: ApplyResult): string {
  if (result.kind === 'success') {
    return green(defaultTemplates.updateSuccess({
      version: result.toVersion,
      postAction: result.postAction,
    }));
  }
  if (result.kind === 'needs-restart') {
    return yellow(result.message);
  }
  return red(defaultTemplates.updateFailed({ error: result.error.message }));
}

/**
 * 감지된 채널에 따라 업데이트 명령어를 결정한다.
 */
function resolveUpdateCommand(detection: InstallDetection): string | undefined {
  switch (detection.channel) {
    case 'npm-global':
      return 'npm update -g <package>';
    case 'brew-cask':
      return 'brew upgrade --cask <package>';
    default:
      return undefined;
  }
}
```

### 4. 훅 통합

훅은 `src/config.ts`의 `Hooks` 인터페이스에 이미 정의되어 있다 (Task 02). UX 레이어는 적절한 시점에 이 훅들을 호출하며, 비동기 훅도 `await`로 처리한다.

```typescript
import type { Hooks } from '../config.js';
import type { UpdatePlan, ApplyResult } from '../types.js';

/**
 * 훅을 안전하게 실행한다.
 * 훅이 정의되지 않았으면 기본값을 반환한다.
 * 훅이 false를 반환하면 해당 작업을 중단한다.
 */
export async function runHook<K extends keyof Hooks>(
  hooks: Hooks | undefined,
  name: K,
  ...args: Parameters<NonNullable<Hooks[K]>>
): Promise<ReturnType<NonNullable<Hooks[K]>> | true> {
  const hook = hooks?.[name];
  if (!hook) return true as any;
  return (hook as Function)(...args);
}
```

훅 호출 시점:
- `before_check`: 버전 확인 직전. `false` 반환 시 확인을 건너뛴다.
- `before_apply`: 업데이트 적용 직전. `false` 반환 시 적용을 건너뛴다.
- `after_apply`: 적용 완료 후. 성공/실패 결과를 전달한다.
- `on_error`: 에러 발생 시. 로깅이나 텔레메트리에 활용한다.

## 생성/수정 파일

| 파일 | 작업 | 설명 |
|------|------|------|
| `src/ux/templates.ts` | 생성 | 메시지 템플릿 인터페이스 및 기본 구현 |
| `src/ux/colors.ts` | 생성 | ANSI 컬러 유틸리티 (NO_COLOR / TTY 감지 포함) |
| `src/ux/index.ts` | 생성 | 렌더링 함수 (renderBanner, renderProgress, renderResult) |
| `src/ux/hooks.ts` | 생성 | 훅 실행 헬퍼 함수 |
| `src/__tests__/ux.test.ts` | 생성 | UX 레이어 테스트 |

## 완료 기준

- [ ] `MessageTemplates` 인터페이스가 정의되고, 5개의 기본 템플릿이 구현되어 있다.
- [ ] `renderBanner()`가 `UpdateStatus`의 `kind`에 따라 적절한 문자열 또는 `null`을 반환한다.
- [ ] `renderProgress()`가 `ApplyProgress`의 `phase`에 따라 진행 상황 문자열을 반환한다.
- [ ] `renderResult()`가 `ApplyResult`의 `kind`에 따라 성공/실패 메시지를 반환한다.
- [ ] TTY 환경에서는 ANSI 컬러가 적용되고, non-TTY 환경에서는 플레인 텍스트가 출력된다.
- [ ] `NO_COLOR` 환경 변수 설정 시 컬러가 비활성화된다.
- [ ] 훅이 적절한 시점에 호출되며, `false` 반환 시 작업이 중단된다.
- [ ] `tsc --noEmit`이 에러 없이 통과한다.
- [ ] `npm run build`가 성공한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 빌드
npm run build

# 3. 테스트 실행
npm test
```

아래 테스트 파일을 작성하여 UX 레이어가 올바르게 동작하는지 검증한다.

```typescript
// src/__tests__/ux.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderBanner, renderProgress, renderResult } from '../ux/index.js';
import { stripAnsi } from '../ux/colors.js';
import type { UpdateStatus, InstallDetection, ApplyProgress, ApplyResult } from '../types.js';

describe('UX 레이어', () => {
  const detection: InstallDetection = {
    channel: 'npm-global',
    confidence: 'high',
    evidence: [{ source: 'path_pattern', detail: 'installed via npm' }],
  };

  describe('renderBanner', () => {
    it('업데이트가 있을 때 배너 문자열을 반환한다', () => {
      const status: UpdateStatus = {
        kind: 'available',
        current: '1.0.0',
        latest: '2.0.0',
      };
      const result = renderBanner(status, detection);
      expect(result).not.toBeNull();
      const plain = stripAnsi(result!);
      expect(plain).toContain('1.0.0');
      expect(plain).toContain('2.0.0');
    });

    it('업데이트가 없으면 null을 반환한다', () => {
      const status: UpdateStatus = { kind: 'up-to-date', current: '2.0.0' };
      expect(renderBanner(status, detection)).toBeNull();
    });

    it('커스텀 템플릿을 적용할 수 있다', () => {
      const status: UpdateStatus = {
        kind: 'available',
        current: '1.0.0',
        latest: '2.0.0',
      };
      const result = renderBanner(status, detection, {
        updateAvailable: ({ current, latest }) => `새 버전 ${latest} (현재: ${current})`,
      });
      const plain = stripAnsi(result!);
      expect(plain).toContain('새 버전');
    });
  });

  describe('ANSI 컬러', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('NO_COLOR 설정 시 ANSI 이스케이프가 포함되지 않는다', () => {
      process.env = { ...originalEnv, NO_COLOR: '1' };
      const status: UpdateStatus = {
        kind: 'available',
        current: '1.0.0',
        latest: '2.0.0',
      };
      const result = renderBanner(status, detection);
      expect(result).not.toContain('\x1b[');
    });
  });

  describe('renderResult', () => {
    it('성공 결과를 렌더링한다', () => {
      const result: ApplyResult = {
        kind: 'success',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        postAction: 'suggest-restart',
      };
      const text = stripAnsi(renderResult(result));
      expect(text).toContain('2.0.0');
      expect(text).toContain('restart');
    });

    it('실패 결과를 렌더링한다', () => {
      const result: ApplyResult = {
        kind: 'failed',
        error: new Error('network timeout'),
        rollbackSucceeded: true,
      };
      const text = stripAnsi(renderResult(result));
      expect(text).toContain('network timeout');
    });
  });
});
```
