# Task 05: 버전 체커

## 목표

현재 버전과 최신 버전을 비교하여 업데이트 가능 여부를 판단하는 버전 체커를 구현한다. Blocking 모드(직접 fetch)와 Non-blocking 모드(캐시 우선 + 백그라운드 갱신)를 지원하며, 오프라인 상황과 Rate Limit 등 다양한 네트워크 조건에서도 안정적으로 동작해야 한다.

## 선행 태스크

- Task 04 (VersionSource) — 버전 정보를 가져오는 소스 인터페이스
- Task 06 (캐시 시스템) — 공동 의존 관계: 체커가 캐시를 읽고 쓰며, 캐시 시스템이 체커의 결과를 저장

## 구현 상세

### 1. 핵심 인터페이스

```typescript
// src/checker/index.ts

import type { VersionSource, VersionSourceResult } from '../checker/sources';
import type { CacheEntry } from '../checker/cache';

/** 체크 모드 */
export type CheckMode = 'blocking' | 'non-blocking';

/** 업데이트 상태 */
export type UpdateStatusKind = 'update-available' | 'up-to-date' | 'unknown';

export interface UpdateStatus {
  kind: UpdateStatusKind;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl?: string;
  releaseNotes?: string;
  source?: string;
  checkedAt: string; // ISO 8601
}

export interface CheckUpdateConfig {
  appName: string;
  currentVersion: string;
  sources: VersionSource[];
  cacheDir: string;
  cacheIntervalMs?: number; // 기본값 72_000_000 (20시간)
}
```

### 2. checkUpdate 메인 함수

```typescript
// src/checker/index.ts

import semver from 'semver';
import { readCache, writeCache, isCacheStale } from './cache';
import { spawnBackgroundCheck } from './background';

export async function checkUpdate(
  config: CheckUpdateConfig,
  mode: CheckMode,
): Promise<UpdateStatus> {
  const { appName, currentVersion, sources, cacheDir, cacheIntervalMs } = config;
  const interval = cacheIntervalMs ?? 72_000_000;

  if (mode === 'non-blocking') {
    return checkNonBlocking(config, interval);
  }

  return checkBlocking(config, interval);
}
```

### 3. Blocking 모드

VersionSource에서 직접 최신 버전을 가져온 뒤, 캐시를 갱신하고 결과를 반환한다.

```typescript
async function checkBlocking(
  config: CheckUpdateConfig,
  intervalMs: number,
): Promise<UpdateStatus> {
  const { appName, currentVersion, sources, cacheDir } = config;
  const cached = await readCache(cacheDir, appName);

  // ETag을 소스에 전달
  const etag = cached?.etag;

  for (const source of sources) {
    try {
      const result = await source.fetchLatestVersion({ etag });

      // 'not-modified' 응답 처리
      if (result.notModified && cached) {
        const updatedEntry: CacheEntry = {
          ...cached,
          lastCheckedAt: new Date().toISOString(),
        };
        await writeCache(cacheDir, appName, updatedEntry);
        return buildStatus(currentVersion, cached.latestVersion, cached);
      }

      // 정상 응답: 캐시 갱신
      const entry: CacheEntry = {
        latestVersion: result.version,
        currentVersionAtCheck: currentVersion,
        lastCheckedAt: new Date().toISOString(),
        source: source.name,
        etag: result.etag,
        releaseUrl: result.releaseUrl,
        releaseNotes: result.releaseNotes,
      };
      await writeCache(cacheDir, appName, entry);

      return buildStatus(currentVersion, result.version, entry);
    } catch (error) {
      // Rate Limit 에러인 경우 캐시 값 사용, 재시도하지 않음
      if (isRateLimitError(error)) {
        if (cached) {
          return buildStatus(currentVersion, cached.latestVersion, cached);
        }
        continue;
      }
      // 네트워크 에러인 경우 다음 소스로 시도
      continue;
    }
  }

  // 모든 소스 실패 → 캐시가 있으면 캐시 사용, 없으면 unknown
  if (cached) {
    return buildStatus(currentVersion, cached.latestVersion, cached);
  }

  return {
    kind: 'unknown',
    currentVersion,
    latestVersion: null,
    checkedAt: new Date().toISOString(),
  };
}
```

### 4. Non-blocking 모드

캐시를 먼저 읽어 즉시 결과를 반환하고, 캐시가 stale이면 백그라운드에서 갱신을 수행한다.

```typescript
async function checkNonBlocking(
  config: CheckUpdateConfig,
  intervalMs: number,
): Promise<UpdateStatus> {
  const { appName, currentVersion, sources, cacheDir } = config;
  const cached = await readCache(cacheDir, appName);

  if (cached && !isCacheStale(cached, intervalMs)) {
    // 유효한 캐시 → 즉시 반환
    return buildStatus(currentVersion, cached.latestVersion, cached);
  }

  // 캐시가 stale이거나 없음 → 백그라운드 갱신 시작
  spawnBackgroundCheck(config, sources);

  // 캐시가 있으면 stale이라도 반환, 없으면 unknown
  if (cached) {
    return buildStatus(currentVersion, cached.latestVersion, cached);
  }

  return {
    kind: 'unknown',
    currentVersion,
    latestVersion: null,
    checkedAt: new Date().toISOString(),
  };
}
```

### 5. 버전 비교 로직

`semver` 패키지를 사용하여 버전을 비교한다. Pre-release 버전은 기본적으로 strip한 뒤 비교한다.

```typescript
import semver from 'semver';

function buildStatus(
  currentVersion: string,
  latestVersion: string,
  entry?: Partial<CacheEntry>,
): UpdateStatus {
  const current = normalizeVersion(currentVersion);
  const latest = normalizeVersion(latestVersion);

  let kind: UpdateStatusKind;

  if (!current || !latest) {
    kind = 'unknown';
  } else if (semver.gt(latest, current)) {
    kind = 'update-available';
  } else {
    kind = 'up-to-date';
  }

  return {
    kind,
    currentVersion,
    latestVersion,
    releaseUrl: entry?.releaseUrl,
    releaseNotes: entry?.releaseNotes,
    source: entry?.source,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 버전 문자열을 정규화한다.
 * - pre-release 태그를 제거하고 메이저.마이너.패치만 남긴다.
 * - semver.valid로 먼저 시도하고, 실패하면 semver.coerce로 변환한다.
 */
function normalizeVersion(version: string): string | null {
  const parsed = semver.valid(version);
  if (parsed) {
    // pre-release 제거: 1.2.3-beta.1 → 1.2.3
    const sv = semver.parse(parsed);
    return sv ? `${sv.major}.${sv.minor}.${sv.patch}` : parsed;
  }

  const coerced = semver.coerce(version);
  return coerced ? coerced.version : null;
}
```

### 6. 에러 판별 유틸리티

```typescript
function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error && 'statusCode' in error) {
    return (error as Error & { statusCode: number }).statusCode === 429;
  }
  return false;
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT';
  }
  return false;
}
```

### 7. 다중 소스 Failover 패턴

소스 목록을 순서대로 시도하며, 첫 번째 성공 결과를 사용한다. 모든 소스가 실패하면 캐시 폴백 또는 `unknown` 상태를 반환한다. Rate Limit 에러는 즉시 캐시 폴백으로 전환하고 다음 소스를 시도하지 않는다(API 제한 보호).

## 생성/수정 파일

| 파일 | 작업 |
|------|------|
| `src/checker/index.ts` | 생성 — `checkUpdate`, `buildStatus`, `normalizeVersion` 등 메인 로직 |
| `src/checker/types.ts` | 생성 — `CheckMode`, `UpdateStatus`, `CheckUpdateConfig` 타입 정의 |
| `tests/checker/index.test.ts` | 생성 — 버전 체커 단위 테스트 |
| `tests/checker/version-compare.test.ts` | 생성 — 버전 비교 엣지 케이스 테스트 |

## 완료 기준

- [ ] `checkUpdate`이 blocking 모드에서 VersionSource를 호출하고, 캐시를 갱신한 뒤 올바른 `UpdateStatus`를 반환한다.
- [ ] Non-blocking 모드에서 캐시가 유효하면 즉시 반환하고, stale이면 백그라운드 갱신을 시작한다.
- [ ] `semver` 비교가 정확히 동작한다: `1.0.0` < `1.1.0`, `2.0.0-beta.1`과 `2.0.0`을 pre-release strip 후 동일하게 판단.
- [ ] ETag/If-Modified-Since를 VersionSource에 전달하고, `not-modified` 응답을 올바르게 처리한다.
- [ ] Rate Limit 에러 시 캐시 값을 사용하고 재시도하지 않는다.
- [ ] 네트워크 에러(오프라인) 시 캐시 값을 사용하거나, 캐시가 없으면 `unknown` 상태를 반환한다.
- [ ] 다중 소스 failover가 동작한다: 첫 번째 소스 실패 시 두 번째 소스를 시도한다.
- [ ] 모든 테스트가 통과한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 단위 테스트 실행
npx vitest run tests/checker/

# 3. Blocking 모드 테스트 — Mock 소스가 'update-available' 반환
npx vitest run tests/checker/index.test.ts -t "blocking mode"

# 4. Non-blocking 모드 테스트 — 캐시 히트 및 백그라운드 갱신
npx vitest run tests/checker/index.test.ts -t "non-blocking mode"

# 5. 버전 비교 엣지 케이스
npx vitest run tests/checker/version-compare.test.ts

# 6. 오프라인 폴백 테스트
npx vitest run tests/checker/index.test.ts -t "offline fallback"

# 7. 커버리지 확인 (checker 모듈 80% 이상)
npx vitest run tests/checker/ --coverage
```
