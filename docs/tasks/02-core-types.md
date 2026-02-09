# Task 02: 핵심 타입 정의

## 목표

프로젝트 전반에서 사용되는 공유 타입, 에러 타입, 설정 인터페이스를 정의한다. 이 타입들은 설치 채널 감지, 버전 확인, 업데이트 계획, 업데이트 적용 등 모든 모듈의 계약(contract)을 형성한다.

## 선행 태스크

- Task 01: 프로젝트 초기 설정

## 구현 상세

### 1. src/types.ts - 공유 타입 정의

프로젝트 전체에서 사용되는 핵심 도메인 타입을 정의한다.

```typescript
// ──────────────────────────────────────────────
// 설치 채널 감지 관련
// ──────────────────────────────────────────────

/** 설치 채널. 알려진 채널 외에 커스텀 문자열도 허용한다. */
export type Channel = 'native' | 'unmanaged' | 'npm-global' | 'brew-cask' | (string & {});

/** 감지 신뢰도 수준 */
export type Confidence = 'none' | 'low' | 'medium' | 'high';

/** 감지 근거. 어떤 소스에서 어떤 정보를 기반으로 판단했는지 기록한다. */
export interface Evidence {
  /** 감지 소스 (예: "path_pattern", "receipt_file", "brew_list") */
  source: string;
  /** 상세 설명 */
  detail: string;
}

/** 설치 채널 감지 결과 */
export interface InstallDetection {
  channel: Channel;
  confidence: Confidence;
  evidence: Evidence[];
}

// ──────────────────────────────────────────────
// 버전 확인 관련
// ──────────────────────────────────────────────

/** 버전 확인 모드. blocking은 결과를 기다리고, non-blocking은 백그라운드 실행 */
export type CheckMode = 'blocking' | 'non-blocking';

/** 버전 확인 결과 */
export type UpdateStatus =
  | {
      kind: 'available';
      current: string;
      latest: string;
      releaseUrl?: string;
      releaseNotes?: string;
    }
  | {
      kind: 'up-to-date';
      current: string;
    }
  | {
      kind: 'unknown';
      reason: string;
      cachedLatest?: string;
    };

// ──────────────────────────────────────────────
// 업데이트 계획 관련
// ──────────────────────────────────────────────

/** 위임 모드. print-only는 명령어만 출력, execute는 직접 실행 */
export type DelegateMode = 'print-only' | 'execute';

/** 업데이트 계획 종류 */
export type PlanKind =
  | {
      type: 'native-in-place';
      downloadUrl: string;
      checksumUrl?: string;
      expectedChecksum?: string;
    }
  | {
      type: 'delegate-command';
      channel: Channel;
      command: string[];
      mode: DelegateMode;
    }
  | {
      type: 'manual-install';
      reason: string;
      instructions: string;
      downloadUrl?: string;
    };

/** 업데이트 적용 후 수행할 동작 */
export type PostAction = 'suggest-restart' | 'exit-after-apply' | 'reexec' | 'none';

/** 업데이트 계획 전체 */
export interface UpdatePlan {
  kind: PlanKind;
  fromVersion: string;
  toVersion: string;
  postAction: PostAction;
}

// ──────────────────────────────────────────────
// 업데이트 적용 관련
// ──────────────────────────────────────────────

/** 적용 진행 상황. 단계별 상태를 discriminated union으로 표현한다. */
export type ApplyProgress =
  | { phase: 'downloading'; bytesDownloaded: number; totalBytes?: number }
  | { phase: 'verifying' }
  | { phase: 'extracting' }
  | { phase: 'replacing' }
  | { phase: 'done' };

/** 적용 결과 */
export type ApplyResult =
  | {
      kind: 'success';
      fromVersion: string;
      toVersion: string;
      postAction: PostAction;
    }
  | {
      kind: 'needs-restart';
      message: string;
    }
  | {
      kind: 'failed';
      error: Error;
      rollbackSucceeded: boolean;
    };
```

### 2. src/errors.ts - 에러 타입 정의

구조화된 에러 코드를 가진 커스텀 에러 클래스를 정의한다. 모든 에러는 `UpdateKitError`를 상속하여 일관된 에러 처리를 가능하게 한다.

```typescript
/**
 * update-kit의 모든 에러가 상속하는 기본 에러 클래스.
 * 구조화된 code 필드를 통해 프로그래밍 방식의 에러 처리를 지원한다.
 */
export class UpdateKitError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'UpdateKitError';
    this.code = code;

    // ES2022 이전 환경 호환을 위한 프로토타입 체인 복원
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ──────────────────────────────────────────────
// 에러 코드 상수
// ──────────────────────────────────────────────

/** 설치 채널 감지 실패 */
export const DETECTION_FAILED = 'DETECTION_FAILED' as const;

/** 네트워크 요청 실패 (타임아웃, DNS 실패 등) */
export const NETWORK_ERROR = 'NETWORK_ERROR' as const;

/** 캐시 읽기/쓰기 실패 */
export const CACHE_ERROR = 'CACHE_ERROR' as const;

/** 버전 문자열 파싱 실패 */
export const VERSION_PARSE = 'VERSION_PARSE' as const;

/** 다운로드된 파일의 체크섬 불일치 */
export const CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH' as const;

/** 서명 검증 실패 */
export const SIGNATURE_INVALID = 'SIGNATURE_INVALID' as const;

/** 사용자 또는 훅이 업데이트 계획을 거부 */
export const PLAN_REJECTED = 'PLAN_REJECTED' as const;

/** 업데이트 적용 중 실패 */
export const APPLY_FAILED = 'APPLY_FAILED' as const;

/** 외부 명령 실행 실패 */
export const COMMAND_FAILED = 'COMMAND_FAILED' as const;

/** 현재 플랫폼에서 지원하지 않는 기능 */
export const UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM' as const;

/** 파일 시스템 권한 부족 */
export const PERMISSION_DENIED = 'PERMISSION_DENIED' as const;

/** 모든 에러 코드의 유니온 타입 */
export type ErrorCode =
  | typeof DETECTION_FAILED
  | typeof NETWORK_ERROR
  | typeof CACHE_ERROR
  | typeof VERSION_PARSE
  | typeof CHECKSUM_MISMATCH
  | typeof SIGNATURE_INVALID
  | typeof PLAN_REJECTED
  | typeof APPLY_FAILED
  | typeof COMMAND_FAILED
  | typeof UNSUPPORTED_PLATFORM
  | typeof PERMISSION_DENIED;
```

### 3. src/config.ts - 설정 인터페이스

사용자가 update-kit을 초기화할 때 전달하는 설정 인터페이스를 정의한다.

```typescript
import type { ApplyResult, DelegateMode, UpdatePlan } from './types.js';
import type { UpdateKitError } from './errors.js';

/**
 * update-kit 전체 설정.
 * 필수 필드는 appName과 currentVersion뿐이며, 나머지는 합리적인 기본값을 가진다.
 */
export interface UpdateKitConfig {
  /** 애플리케이션 이름 (예: "my-cli") */
  appName: string;

  /** 현재 설치된 버전 (semver 문자열) */
  currentVersion: string;

  /** 버전 확인 소스 목록. 순서대로 시도하며 첫 번째 성공 결과를 사용한다. */
  sources?: VersionSourceConfig[];

  /** 버전 확인 간격 (밀리초). 기본값: 72_000_000 (20시간) */
  checkInterval?: number;

  /** 캐시 디렉터리 경로. 기본값: OS별 표준 캐시 경로 */
  cacheDir?: string;

  /** 위임 모드. 기본값: 'print-only' */
  delegateMode?: DelegateMode;

  /** npm 패키지 이름 (npm-global 채널 감지 및 업데이트에 사용) */
  npmPackageName?: string;

  /** Homebrew cask 이름 (brew-cask 채널 감지 및 업데이트에 사용) */
  brewCaskName?: string;

  /** re-exec 허용 여부. 기본값: false. true일 경우 업데이트 후 새 바이너리로 재실행 */
  allowReexec?: boolean;

  /**
   * 에셋 파일명 패턴. 플레이스홀더를 사용하여 플랫폼별 에셋을 매칭한다.
   * 예: "{app}-{version}-{target}.tar.gz"
   * 플레이스홀더: {app}, {version}, {target}, {arch}, {ext}
   */
  assetPattern?: string;

  /** 라이프사이클 훅 */
  hooks?: Hooks;
}

/**
 * 라이프사이클 훅.
 * 각 훅은 동기 또는 비동기 함수를 받을 수 있다.
 */
export interface Hooks {
  /** 버전 확인 전 호출. false를 반환하면 확인을 건너뛴다. */
  beforeCheck?: () => boolean | Promise<boolean>;

  /** 업데이트 적용 전 호출. false를 반환하면 적용을 건너뛴다. */
  beforeApply?: (plan: UpdatePlan) => boolean | Promise<boolean>;

  /** 업데이트 적용 후 호출. 성공/실패와 관계없이 결과를 전달한다. */
  afterApply?: (result: ApplyResult) => void | Promise<void>;

  /** 에러 발생 시 호출. 에러 로깅, 텔레메트리 등에 활용한다. */
  onError?: (error: UpdateKitError) => void | Promise<void>;
}

/**
 * 버전 소스 설정. type 필드로 소스 종류를 구분하며,
 * 소스별 추가 옵션은 인덱스 시그니처로 허용한다.
 */
export interface VersionSourceConfig {
  /** 소스 유형 */
  type: 'github' | 'npm' | 'jsr' | 'brew' | 'custom';

  /** 소스별 추가 설정 */
  [key: string]: unknown;
}
```

### 4. src/index.ts - 공개 API 재수출

모든 공개 타입과 클래스를 단일 진입점에서 re-export한다.

```typescript
// Types
export type {
  Channel,
  Confidence,
  Evidence,
  InstallDetection,
  CheckMode,
  UpdateStatus,
  DelegateMode,
  PlanKind,
  PostAction,
  UpdatePlan,
  ApplyProgress,
  ApplyResult,
} from './types.js';

// Errors
export {
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
} from './errors.js';
export type { ErrorCode } from './errors.js';

// Config
export type {
  UpdateKitConfig,
  Hooks,
  VersionSourceConfig,
} from './config.js';
```

## 생성/수정 파일

| 파일 | 작업 | 설명 |
|------|------|------|
| `src/types.ts` | 생성 | 공유 도메인 타입 정의 |
| `src/errors.ts` | 생성 | 에러 클래스 및 에러 코드 상수 정의 |
| `src/config.ts` | 생성 | 설정 인터페이스 및 훅 정의 |
| `src/index.ts` | 수정 | 모든 공개 타입 re-export 추가 |

## 완료 기준

- [ ] `src/types.ts`에 모든 도메인 타입이 정의되어 있다: `Channel`, `Confidence`, `Evidence`, `InstallDetection`, `CheckMode`, `UpdateStatus`, `DelegateMode`, `PlanKind`, `PostAction`, `UpdatePlan`, `ApplyProgress`, `ApplyResult`.
- [ ] `src/errors.ts`에 `UpdateKitError` 클래스가 정의되어 있고, 11개 에러 코드 상수가 export 된다.
- [ ] `src/config.ts`에 `UpdateKitConfig`, `Hooks`, `VersionSourceConfig` 인터페이스가 정의되어 있다.
- [ ] `src/index.ts`에서 모든 공개 타입을 re-export한다.
- [ ] `tsc --noEmit`이 에러 없이 통과한다.
- [ ] `npm run build`가 성공한다.

## 검증 방법

```bash
# 1. 타입 검사 통과
npx tsc --noEmit

# 2. 빌드 성공
npm run build

# 3. 타입 import 테스트 (vitest)
```

아래 테스트 파일을 작성하여 타입이 올바르게 export 되는지 검증한다.

```typescript
// src/__tests__/types.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  Channel,
  Confidence,
  Evidence,
  InstallDetection,
  UpdateStatus,
  UpdatePlan,
  ApplyResult,
  UpdateKitConfig,
} from '../index.js';
import { UpdateKitError, NETWORK_ERROR } from '../index.js';

describe('핵심 타입', () => {
  it('Channel 타입이 알려진 채널과 커스텀 문자열을 허용한다', () => {
    const native: Channel = 'native';
    const custom: Channel = 'my-custom-channel';
    expectTypeOf(native).toMatchTypeOf<Channel>();
    expectTypeOf(custom).toMatchTypeOf<Channel>();
  });

  it('UpdateStatus가 discriminated union이다', () => {
    const status: UpdateStatus = {
      kind: 'available',
      current: '1.0.0',
      latest: '2.0.0',
    };
    if (status.kind === 'available') {
      expectTypeOf(status.latest).toBeString();
    }
  });

  it('UpdateKitError가 code 필드를 가진다', () => {
    const err = new UpdateKitError(NETWORK_ERROR, 'request failed');
    expectTypeOf(err.code).toBeString();
    expectTypeOf(err).toMatchTypeOf<Error>();
  });
});
```
