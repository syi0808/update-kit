# Task 09: 업데이트 적용 - Delegate Commands

## 목표

패키지 매니저(npm, Homebrew 등)에 업데이트를 위임하는 적용기를 구현한다. 명령어를 출력만 하는 PrintOnly 모드와 실제로 실행하는 Execute 모드를 지원하며, 각 패키지 매니저의 에러 패턴을 정규화하여 일관된 결과를 반환한다.

## 선행 태스크

- Task 07 (업데이트 플래너) — `UpdatePlan`의 `delegate-command` 타입 정의

## 구현 상세

### 1. 인터페이스 정의

```typescript
// src/applier/delegate.ts

import type { UpdatePlan, PostAction } from '../planner';
import type { ApplyOptions, ApplyProgress, ApplyResult } from './types';

export type DelegateMode = 'print-only' | 'execute';

export interface DelegateApplyResult extends ApplyResult {
  /** 실행된 명령어 */
  command: string[];
  /** 표준 출력 (Execute 모드에서만) */
  stdout?: string;
  /** 표준 에러 (Execute 모드에서만) */
  stderr?: string;
}

export interface DelegateApplyOptions extends ApplyOptions {
  /** delegate 모드 (기본값: 'print-only') */
  mode?: DelegateMode;
  /** 명령어 실행 타임아웃 (밀리초, 기본값: 120_000) */
  timeoutMs?: number;
}
```

### 2. 메인 적용 함수

```typescript
export async function applyDelegateUpdate(
  plan: UpdatePlan & { kind: { type: 'delegate-command' } },
  options: DelegateApplyOptions = {},
): Promise<DelegateApplyResult> {
  const { kind } = plan;
  const { command, postAction } = kind;
  const mode = options.mode ?? 'print-only';

  if (mode === 'print-only') {
    return applyPrintOnly(plan, command);
  }

  return applyExecute(plan, command, postAction, options);
}
```

### 3. PrintOnly 모드

명령어를 조립하여 사용자에게 표시할 메시지만 반환한다. 실제 실행은 하지 않으므로 사이드 이펙트가 없다.

```typescript
function applyPrintOnly(
  plan: UpdatePlan,
  command: string[],
): DelegateApplyResult {
  const commandStr = command.join(' ');

  return {
    success: true,
    postAction: 'suggest-restart',
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    command,
    message: `다음 명령어를 실행하여 업데이트하세요:\n\n  ${commandStr}`,
  };
}
```

### 4. Execute 모드

`child_process.spawn`을 사용하여 명령어를 실제로 실행한다. stdout/stderr를 스트리밍으로 수집하고, `onProgress` 콜백으로 중간 출력을 전달한다.

```typescript
import { spawn } from 'node:child_process';

async function applyExecute(
  plan: UpdatePlan,
  command: string[],
  postAction: PostAction,
  options: DelegateApplyOptions,
): Promise<DelegateApplyResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const { onProgress, signal } = options;

  return new Promise((resolve, reject) => {
    const commandStr = command.join(' ');

    // shell: true — "&&" 체이닝 지원 (예: "brew update && brew upgrade --cask")
    const child = spawn(commandStr, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    // 타임아웃 설정
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(
        new UpdateKitError(
          'COMMAND_TIMEOUT',
          `명령어 실행 타임아웃 (${timeoutMs}ms): ${commandStr}`,
        ),
      );
    }, timeoutMs);

    // AbortSignal 처리
    if (signal) {
      signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
        reject(
          new UpdateKitError('COMMAND_ABORTED', '명령어 실행이 취소되었습니다.'),
        );
      }, { once: true });
    }

    // stdout 수집 및 진행률 보고
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onProgress?.({
        phase: 'execute',
        output: text,
        stream: 'stdout',
      } as ApplyProgress & { output: string; stream: string });
    });

    // stderr 수집
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onProgress?.({
        phase: 'execute',
        output: text,
        stream: 'stderr',
      } as ApplyProgress & { output: string; stream: string });
    });

    // 프로세스 종료 처리
    child.on('close', (exitCode) => {
      clearTimeout(timer);

      try {
        const result = normalizeResult(
          exitCode ?? 1,
          stdout,
          stderr,
          command,
          plan,
          postAction,
        );
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });

    // 프로세스 시작 에러
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        new UpdateKitError(
          'COMMAND_SPAWN_FAILED',
          `명령어 실행 실패: ${error.message}`,
        ),
      );
    });
  });
}
```

### 5. 명령어 템플릿

각 패키지 매니저별 명령어 생성 로직이다. 이 로직은 플래너(Task 07)에서 `delegate-command`의 `command` 필드로 이미 생성되지만, 참조용으로 정리한다.

```typescript
// 참조: 플래너에서 생성되는 명령어 템플릿

/** npm 글로벌 설치 */
function npmCommand(packageName: string, version: string): string[] {
  return ['npm', 'install', '-g', `${packageName}@${version}`];
}

/** Homebrew cask 업그레이드 */
function brewCommand(caskName: string): string[] {
  // shell: true로 실행하므로 && 체이닝 가능
  return ['brew', 'update', '&&', 'brew', 'upgrade', '--cask', caskName];
}

/** 커스텀 채널: plan에서 직접 지정 */
// command는 plan.kind.command에서 그대로 사용
```

### 6. 에러 정규화

패키지 매니저별 종료 코드와 출력 패턴을 분석하여 일관된 결과로 변환한다.

```typescript
function normalizeResult(
  exitCode: number,
  stdout: string,
  stderr: string,
  command: string[],
  plan: UpdatePlan,
  postAction: PostAction,
): DelegateApplyResult {
  const commandStr = command.join(' ');

  // 성공
  if (exitCode === 0) {
    return {
      success: true,
      postAction,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      command,
      stdout,
      stderr,
    };
  }

  // npm EACCES — 권한 문제
  if (isNpmPermissionError(stderr)) {
    throw new UpdateKitError(
      'PERMISSION_DENIED',
      `npm 권한 오류: 적절한 권한으로 다시 실행하세요.\n명령어: ${commandStr}`,
    );
  }

  // brew "already installed" — 이미 최신이므로 성공 처리
  if (isBrewAlreadyInstalled(stdout, stderr)) {
    return {
      success: true,
      postAction,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      command,
      stdout,
      stderr,
    };
  }

  // 기타 실패
  throw new UpdateKitError(
    'COMMAND_FAILED',
    `명령어 실패 (exit code ${exitCode}): ${commandStr}\n${stderr}`.trim(),
  );
}

function isNpmPermissionError(stderr: string): boolean {
  return (
    stderr.includes('EACCES') ||
    stderr.includes('permission denied') ||
    stderr.includes('Missing write access')
  );
}

function isBrewAlreadyInstalled(stdout: string, stderr: string): boolean {
  const combined = stdout + stderr;
  return (
    combined.includes('already installed') ||
    combined.includes('already up-to-date') ||
    combined.includes('is already the latest version')
  );
}
```

### 7. 에러 타입

```typescript
// src/errors.ts (기존 에러 모듈에 추가)

export type DelegateErrorCode =
  | 'COMMAND_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_ABORTED'
  | 'COMMAND_SPAWN_FAILED'
  | 'PERMISSION_DENIED';

export class UpdateKitError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UpdateKitError';
  }
}
```

### 8. 명령어 검증

Execute 모드에서 실행 전에 명령어의 기본적인 안전성을 검증한다.

```typescript
/**
 * 명령어가 허용 목록에 포함된 프로그램인지 확인한다.
 * 임의의 명령어 실행을 방지하기 위한 기본 안전장치.
 */
const ALLOWED_COMMANDS = new Set(['npm', 'npx', 'brew', 'apt', 'apt-get', 'yum', 'dnf', 'choco', 'winget', 'scoop']);

function validateCommand(command: string[]): void {
  if (command.length === 0) {
    throw new UpdateKitError('COMMAND_FAILED', '빈 명령어입니다.');
  }

  const baseCommand = command[0];
  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    throw new UpdateKitError(
      'COMMAND_FAILED',
      `허용되지 않는 명령어입니다: ${baseCommand}. 허용 목록: ${[...ALLOWED_COMMANDS].join(', ')}`,
    );
  }
}
```

## 생성/수정 파일

| 파일 | 작업 |
|------|------|
| `src/applier/delegate.ts` | 생성 — `applyDelegateUpdate`, PrintOnly/Execute 모드, 에러 정규화 |
| `src/applier/types.ts` | 수정 — `DelegateApplyResult`, `DelegateApplyOptions` 타입 추가 |
| `src/errors.ts` | 수정 — `DelegateErrorCode` 추가 |
| `tests/applier/delegate.test.ts` | 생성 — PrintOnly/Execute 모드 테스트 |
| `tests/applier/delegate-errors.test.ts` | 생성 — 에러 정규화 테스트 |

## 완료 기준

- [ ] PrintOnly 모드가 사이드 이펙트 없이 명령어 문자열만 반환한다.
- [ ] PrintOnly 모드의 반환값에 실행 가능한 명령어 문자열이 포함된다.
- [ ] Execute 모드가 `child_process.spawn`으로 명령어를 실행한다.
- [ ] Execute 모드에서 `shell: true`를 사용하여 `&&` 체이닝이 동작한다.
- [ ] stdout/stderr를 수집하고 `onProgress` 콜백으로 스트리밍 전달한다.
- [ ] 종료 코드 0이면 성공 결과를 반환한다.
- [ ] npm EACCES 에러를 `PERMISSION_DENIED`로 정규화한다.
- [ ] brew "already installed" 패턴을 성공으로 처리한다.
- [ ] 타임아웃(기본 120초) 초과 시 프로세스를 종료하고 `COMMAND_TIMEOUT` 에러를 반환한다.
- [ ] `AbortSignal`로 실행 중인 명령어를 취소할 수 있다.
- [ ] 허용 목록에 없는 명령어는 실행을 거부한다.
- [ ] 모든 테스트가 통과한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 전체 delegate 테스트
npx vitest run tests/applier/delegate.test.ts

# 3. PrintOnly 모드 테스트 — 사이드 이펙트 없음 확인
npx vitest run tests/applier/delegate.test.ts -t "print-only"

# 4. Execute 모드 테스트 — 안전한 Mock 명령어 사용
npx vitest run tests/applier/delegate.test.ts -t "execute mode"

# 5. 에러 정규화 테스트
npx vitest run tests/applier/delegate-errors.test.ts

# 6. 타임아웃 테스트
npx vitest run tests/applier/delegate.test.ts -t "timeout"

# 7. AbortSignal 테스트
npx vitest run tests/applier/delegate.test.ts -t "abort"

# 8. 커버리지 확인 (delegate 모듈 85% 이상)
npx vitest run tests/applier/delegate*.test.ts --coverage

# 9. 수동 검증 — PrintOnly 모드
node -e "
const { applyDelegateUpdate } = require('./dist/index.cjs');
const plan = {
  kind: { type: 'delegate-command', command: ['npm', 'install', '-g', 'my-app@2.0.0'], postAction: 'exit-after-apply' },
  fromVersion: '1.0.0',
  toVersion: '2.0.0',
  channel: 'npm-global',
};
applyDelegateUpdate(plan, { mode: 'print-only' }).then(console.log);
"

# 10. 수동 검증 — Execute 모드 (안전한 명령어)
node -e "
const { applyDelegateUpdate } = require('./dist/index.cjs');
const plan = {
  kind: { type: 'delegate-command', command: ['npm', '--version'], postAction: 'suggest-restart' },
  fromVersion: '1.0.0',
  toVersion: '2.0.0',
  channel: 'npm-global',
};
applyDelegateUpdate(plan, { mode: 'execute' }).then(console.log);
"
```
