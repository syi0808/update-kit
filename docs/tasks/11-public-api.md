# Task 11: 퍼블릭 API 통합

## 목표

모든 모듈을 하나의 `UpdateKit` 클래스로 통합하는 퍼블릭 API를 구현한다. 설치 채널 감지, 버전 확인, 업데이트 계획, 업데이트 적용, UX 렌더링을 단일 진입점에서 오케스트레이션하며, 간편한 원라이너 메서드(`checkAndNotify`, `autoUpdate`)를 제공한다.

## 선행 태스크

- Task 03: 설치 채널 감지
- Task 05: 버전 소스 플러그인
- Task 06: 버전 체커 + 캐시
- Task 07: 업데이트 플래너
- Task 08: 업데이트 어플라이어 (네이티브)
- Task 09: 업데이트 어플라이어 (위임)
- Task 10: UX 레이어

## 구현 상세

### 1. src/index.ts - 메인 엔트리 포인트

기존의 타입 re-export를 유지하면서 `UpdateKit` 클래스를 추가한다. 이 클래스가 라이브러리의 주요 퍼블릭 API 역할을 한다.

```typescript
import type {
  UpdateKitConfig, Hooks, VersionSourceConfig,
} from './config.js';
import type {
  Channel, Confidence, Evidence, InstallDetection,
  CheckMode, UpdateStatus, UpdatePlan, PlanKind, PostAction,
  DelegateMode, ApplyResult, ApplyProgress, ApplyOptions,
} from './types.js';
import type { VersionSource, VersionSourceConfig, VersionInfo, AssetInfo } from './checker/sources/index.js';
import type { MessageTemplates } from './ux/templates.js';

export class UpdateKit {
  private readonly config: UpdateKitConfig;

  constructor(config: UpdateKitConfig) {
    this.config = this.validateConfig(config);
  }

  /** 설치 채널 감지 */
  async detectInstall(): Promise<InstallDetection> {
    // detection 모듈 호출
    // hooks.beforeCheck 등은 여기서 호출하지 않음 (감지는 항상 실행)
  }

  /** 업데이트 체크 (기본: non-blocking) */
  async checkUpdate(mode: CheckMode = 'non-blocking'): Promise<UpdateStatus> {
    // 1. beforeCheck 훅 호출 → false이면 { kind: 'unknown', reason: 'skipped by hook' } 반환
    // 2. 캐시 확인 → 유효하면 캐시된 결과 반환
    // 3. sources를 순서대로 시도하여 최신 버전 확인
    // 4. 결과를 캐시에 저장
    // 5. 현재 버전과 비교하여 UpdateStatus 반환
  }

  /** 업데이트 계획 수립 */
  planUpdate(status: UpdateStatus, detection: InstallDetection): UpdatePlan {
    // 채널과 상태에 따라 적절한 PlanKind 결정
    // postAction 결정 (config.allowReexec 등 고려)
  }

  /** 업데이트 적용 */
  async applyUpdate(plan: UpdatePlan, options?: ApplyOptions): Promise<ApplyResult> {
    // 1. beforeApply 훅 호출 → false이면 { kind: 'failed', error, rollbackSucceeded: true } 반환
    // 2. plan.kind.type에 따라 적절한 어플라이어 실행
    // 3. afterApply 훅 호출
    // 4. 에러 발생 시 onError 훅 호출
  }

  // ─── 편의 메서드 ───

  /**
   * 캐시 기반 빠른 체크 후 배너 문자열을 반환한다.
   * 업데이트가 없으면 null을 반환한다.
   * 앱 시작 시 원라이너로 사용하기 위한 메서드.
   *
   * @example
   * ```typescript
   * const kit = new UpdateKit({ appName: 'my-cli', currentVersion: '1.0.0' });
   * const banner = await kit.checkAndNotify();
   * if (banner) console.error(banner);
   * ```
   */
  async checkAndNotify(): Promise<string | null> {
    // 1. non-blocking 모드로 checkUpdate 호출
    // 2. detectInstall 호출
    // 3. renderBanner(status, detection) 반환
  }

  /**
   * 전체 업데이트 흐름을 자동으로 실행한다: detect → check → plan → apply
   *
   * @example
   * ```typescript
   * const kit = new UpdateKit(config);
   * const result = await kit.autoUpdate();
   * if (result.kind === 'success') {
   *   console.log(`Updated to ${result.toVersion}`);
   * }
   * ```
   */
  async autoUpdate(options?: ApplyOptions): Promise<ApplyResult> {
    // 1. detectInstall()
    // 2. checkUpdate('blocking')
    // 3. status가 'available'이 아니면 early return
    // 4. planUpdate(status, detection)
    // 5. applyUpdate(plan, options)
    // 에러 발생 시 onError 훅 호출 후 failed 결과 반환
  }

  // ─── 내부 메서드 ───

  private validateConfig(config: UpdateKitConfig): UpdateKitConfig {
    if (!config.appName) throw new Error('appName is required');
    if (!config.currentVersion) throw new Error('currentVersion is required');
    // semver 유효성 검사
    return {
      checkInterval: 72_000_000, // 20시간 기본값
      delegateMode: 'print-only',
      allowReexec: false,
      ...config,
    };
  }
}
```

### 2. 타입 Re-export

모든 공개 타입을 `src/index.ts`에서 re-export하여 사용자가 단일 진입점에서 모든 것을 import할 수 있도록 한다.

```typescript
// Re-export all types
export type {
  UpdateKitConfig, Channel, Confidence, Evidence, InstallDetection,
  CheckMode, UpdateStatus, UpdatePlan, PlanKind, PostAction,
  DelegateMode, ApplyResult, ApplyProgress, ApplyOptions,
  VersionSource, VersionSourceConfig, VersionInfo, AssetInfo,
  MessageTemplates, Hooks,
};

// Re-export errors
export { UpdateKitError } from './errors.js';
export type { ErrorCode } from './errors.js';
```

### 3. 구현 세부사항

**Constructor**:
- 설정 유효성 검사 (appName, currentVersion 필수)
- 재사용 가능한 HTTP 클라이언트 초기화
- sources 배열 기반으로 VersionSource 인스턴스 생성

**checkAndNotify()**:
- non-blocking 체크 수행 후 `renderBanner()` 호출
- 앱 시작 시 원라이너로 사용하는 것이 주요 유스케이스
- 에러 발생 시 조용히 null 반환 (앱 시작을 방해하지 않음)

**autoUpdate()**:
- 전체 파이프라인을 에러 핸들링과 함께 실행
- 각 단계에서 적절한 훅을 호출
- 실패 시에도 항상 `ApplyResult`를 반환 (throw하지 않음)

**TSDoc**:
- 모든 공개 API에 TSDoc 주석을 작성한다
- `@example` 태그로 사용 예시를 포함한다
- `@param`, `@returns` 태그로 파라미터와 반환값을 문서화한다

## 생성/수정 파일

| 파일 | 작업 | 설명 |
|------|------|------|
| `src/index.ts` | 수정 (전면 재작성) | `UpdateKit` 클래스 추가 및 전체 타입 re-export |
| `src/__tests__/integration.test.ts` | 생성 | 전체 흐름 통합 테스트 |

## 완료 기준

- [ ] `UpdateKit` 클래스가 export 되고, `constructor`, `detectInstall`, `checkUpdate`, `planUpdate`, `applyUpdate`, `checkAndNotify`, `autoUpdate` 메서드를 가진다.
- [ ] `constructor`가 잘못된 설정에 대해 에러를 던진다 (appName, currentVersion 누락 시).
- [ ] `checkAndNotify()`가 업데이트가 없으면 `null`을, 있으면 배너 문자열을 반환한다.
- [ ] `autoUpdate()`가 전체 파이프라인을 실행하고 `ApplyResult`를 반환한다.
- [ ] 모든 공개 타입이 `src/index.ts`에서 re-export 된다.
- [ ] 각 메서드에서 적절한 시점에 훅이 호출된다.
- [ ] 모든 공개 API에 TSDoc 주석이 작성되어 있다.
- [ ] `tsc --noEmit`이 에러 없이 통과한다.
- [ ] `npm run build`가 성공한다.
- [ ] 통합 테스트가 모킹된 소스로 전체 흐름을 검증한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 빌드
npm run build

# 3. 테스트 실행
npm test
```

아래 통합 테스트를 작성하여 전체 흐름이 올바르게 동작하는지 검증한다.

```typescript
// src/__tests__/integration.test.ts
import { describe, it, expect, vi } from 'vitest';
import { UpdateKit } from '../index.js';

// Mock version source
const mockSource = {
  type: 'custom' as const,
  // ... mock implementation
};

describe('UpdateKit 통합 테스트', () => {
  it('checkAndNotify가 업데이트 가능 시 배너를 반환한다', async () => {
    const kit = new UpdateKit({
      appName: 'test-app',
      currentVersion: '1.0.0',
      sources: [mockSource],
    });

    const banner = await kit.checkAndNotify();
    // 모킹된 소스가 최신 버전 2.0.0을 반환하면 배너가 non-null이어야 한다
    expect(banner).not.toBeNull();
  });

  it('autoUpdate가 전체 파이프라인을 실행한다', async () => {
    const hooks = {
      beforeCheck: vi.fn().mockReturnValue(true),
      beforeApply: vi.fn().mockReturnValue(true),
      afterApply: vi.fn(),
    };

    const kit = new UpdateKit({
      appName: 'test-app',
      currentVersion: '1.0.0',
      sources: [mockSource],
      hooks,
    });

    const result = await kit.autoUpdate();
    expect(hooks.beforeCheck).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.kind).toBeDefined();
  });

  it('잘못된 설정으로 생성 시 에러를 던진다', () => {
    expect(() => new UpdateKit({ appName: '', currentVersion: '1.0.0' })).toThrow();
    expect(() => new UpdateKit({ appName: 'test', currentVersion: '' })).toThrow();
  });

  it('beforeCheck 훅이 false를 반환하면 체크를 건너뛴다', async () => {
    const kit = new UpdateKit({
      appName: 'test-app',
      currentVersion: '1.0.0',
      hooks: {
        beforeCheck: () => false,
      },
    });

    const status = await kit.checkUpdate();
    expect(status.kind).toBe('unknown');
  });
});
```
