# Task 06: 캐시 시스템

## 목표

버전 체크 결과를 파일 시스템에 영속적으로 저장하는 캐시 시스템을 구현한다. TTL 기반 만료 판단, 원자적 파일 쓰기, 동시 접근 안전성, 그리고 플랫폼별 기본 캐시/설정 디렉터리 경로를 제공한다.

## 선행 태스크

- Task 02 (타입 시스템) — 공유 타입 정의 및 에러 타입

## 구현 상세

### 1. 캐시 엔트리 인터페이스

캐시 파일은 `{cacheDir}/{appName}/update-check.json` 경로에 JSON 형식으로 저장된다.

```typescript
// src/checker/cache.ts

export interface CacheEntry {
  /** 소스에서 가져온 최신 버전 */
  latestVersion: string;

  /** 체크 시점의 현재 버전 */
  currentVersionAtCheck: string;

  /** 마지막 체크 시각 (ISO 8601) */
  lastCheckedAt: string;

  /** 버전 소스 식별자 (예: "github:owner/repo") */
  source: string;

  /** HTTP ETag (조건부 요청용) */
  etag?: string;

  /** 릴리스 페이지 URL */
  releaseUrl?: string;

  /** 릴리스 노트 (마크다운 등) */
  releaseNotes?: string;
}
```

### 2. 캐시 읽기

JSON 파일을 읽어 `CacheEntry`를 반환한다. 파일이 없거나 손상된 경우 `null`을 반환한다.

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readCache(
  cacheDir: string,
  appName: string,
): Promise<CacheEntry | null> {
  const filePath = getCachePath(cacheDir, appName);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // 필수 필드 검증
    if (
      typeof parsed.latestVersion !== 'string' ||
      typeof parsed.currentVersionAtCheck !== 'string' ||
      typeof parsed.lastCheckedAt !== 'string' ||
      typeof parsed.source !== 'string'
    ) {
      return null;
    }

    return parsed as CacheEntry;
  } catch {
    // ENOENT(파일 없음), SyntaxError(JSON 파싱 실패) 등 모두 null 반환
    return null;
  }
}

function getCachePath(cacheDir: string, appName: string): string {
  return path.join(cacheDir, appName, 'update-check.json');
}
```

### 3. 캐시 쓰기 (원자적)

임시 파일에 먼저 기록한 뒤 `rename`으로 교체한다. 같은 파일시스템 내의 `rename`은 원자적이므로 부분 기록이 발생하지 않는다.

```typescript
export async function writeCache(
  cacheDir: string,
  appName: string,
  entry: CacheEntry,
): Promise<void> {
  const filePath = getCachePath(cacheDir, appName);
  const dir = path.dirname(filePath);

  // 디렉터리가 없으면 생성
  await fs.mkdir(dir, { recursive: true });

  // 동시 접근 대비: PID와 타임스탬프로 고유한 임시 파일명 생성
  const tmpPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;

  try {
    const data = JSON.stringify(entry, null, 2) + '\n';
    await fs.writeFile(tmpPath, data, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    // 임시 파일 정리 시도
    try {
      await fs.unlink(tmpPath);
    } catch {
      // 무시 — 이미 삭제되었거나 존재하지 않음
    }
    throw error;
  }
}
```

### 4. 캐시 만료 판단

`lastCheckedAt` 시각에 TTL 인터벌을 더한 값이 현재 시각보다 이전이면 stale로 판단한다.

```typescript
/**
 * 캐시가 stale인지 판단한다.
 * @param entry - 캐시 엔트리
 * @param intervalMs - 캐시 유효 기간 (밀리초). 기본값: 72_000_000 (20시간)
 */
export function isCacheStale(entry: CacheEntry, intervalMs: number): boolean {
  const checkedAt = new Date(entry.lastCheckedAt).getTime();

  // ISO 8601 파싱 실패 시 stale 처리
  if (Number.isNaN(checkedAt)) {
    return true;
  }

  return Date.now() > checkedAt + intervalMs;
}
```

### 5. 캐시 삭제

```typescript
export async function clearCache(
  cacheDir: string,
  appName: string,
): Promise<void> {
  const filePath = getCachePath(cacheDir, appName);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    // 파일이 없으면 무시
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
```

### 6. 플랫폼별 기본 경로

XDG Base Directory Specification을 따르되, Windows에서는 `LOCALAPPDATA`를 사용한다.

```typescript
// src/platform/paths.ts

import path from 'node:path';
import os from 'node:os';

/**
 * 기본 캐시 디렉터리를 반환한다.
 * - Unix: $XDG_CACHE_HOME 또는 ~/.cache
 * - Windows: %LOCALAPPDATA%
 */
export function getDefaultCacheDir(): string {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  }

  return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
}

/**
 * 기본 설정 디렉터리를 반환한다.
 * - Unix: $XDG_CONFIG_HOME 또는 ~/.config
 * - Windows: %LOCALAPPDATA%
 */
export function getDefaultConfigDir(): string {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  }

  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
}
```

### 7. 백그라운드 체크

Non-blocking 모드에서 호출되는 fire-and-forget 백그라운드 태스크다. 절대 throw하거나 호출자를 block하지 않는다.

```typescript
// src/checker/background.ts

import type { VersionSource } from '../checker/sources';
import type { CheckUpdateConfig } from '../checker/index';
import type { CacheEntry } from './cache';
import { writeCache } from './cache';

/**
 * 백그라운드에서 최신 버전을 fetch하고 캐시를 갱신한다.
 * - AbortController로 타임아웃(기본 10초)을 적용한다.
 * - 에러가 발생해도 throw하지 않고 조용히 종료한다.
 */
export function spawnBackgroundCheck(
  config: CheckUpdateConfig,
  sources: VersionSource[],
  timeoutMs: number = 10_000,
): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // fire-and-forget: .catch로 에러를 삼킨다
  backgroundFetch(config, sources, controller.signal)
    .catch(() => {
      // 의도적으로 무시 — 백그라운드 작업 실패는 조용히 처리
    })
    .finally(() => {
      clearTimeout(timer);
    });
}

async function backgroundFetch(
  config: CheckUpdateConfig,
  sources: VersionSource[],
  signal: AbortSignal,
): Promise<void> {
  const { appName, currentVersion, cacheDir } = config;

  for (const source of sources) {
    if (signal.aborted) return;

    try {
      const result = await source.fetchLatestVersion({ signal });

      if (result.notModified) return;

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
      return; // 첫 번째 성공 시 종료
    } catch {
      continue; // 다음 소스 시도
    }
  }
}
```

### 8. 기본 캐시 인터벌

기본값은 20시간(`72_000_000`ms)이다. CLI 도구의 일반적인 사용 패턴(하루에 몇 번)을 고려한 값으로, 사용자가 설정으로 오버라이드할 수 있다.

### 9. 동시 접근 전략

- 원자적 쓰기: 임시 파일 → `rename` 패턴으로 부분 기록 방지
- 고유 임시 파일명: `{path}.{pid}-{timestamp}.tmp`로 프로세스 간 충돌 방지
- 읽기 시 손상 감지: JSON 파싱 실패 시 `null` 반환(자동 복구)
- 다른 프로세스의 `.tmp` 파일이 남아 있어도 정상 동작에 영향 없음

## 생성/수정 파일

| 파일 | 작업 |
|------|------|
| `src/checker/cache.ts` | 생성 — `readCache`, `writeCache`, `isCacheStale`, `clearCache` |
| `src/platform/paths.ts` | 생성 — `getDefaultCacheDir`, `getDefaultConfigDir` |
| `src/checker/background.ts` | 생성 — `spawnBackgroundCheck` |
| `tests/checker/cache.test.ts` | 생성 — 캐시 읽기/쓰기/만료/삭제 테스트 |
| `tests/checker/background.test.ts` | 생성 — 백그라운드 체크 테스트 |
| `tests/platform/paths.test.ts` | 생성 — 플랫폼 경로 테스트 |

## 완료 기준

- [ ] `readCache`가 정상 JSON 파일에서 `CacheEntry`를 올바르게 파싱한다.
- [ ] `readCache`가 존재하지 않는 파일에 대해 `null`을 반환한다.
- [ ] `readCache`가 손상된 JSON(잘린 파일, 잘못된 구조)에 대해 `null`을 반환한다.
- [ ] `writeCache`가 원자적으로 파일을 기록한다 — 부분 기록이 발생하지 않는다.
- [ ] `writeCache`가 디렉터리가 없으면 자동 생성한다.
- [ ] `writeCache`가 동시 호출 시 고유한 임시 파일명을 사용한다.
- [ ] `isCacheStale`이 TTL 내의 엔트리에 대해 `false`, 만료된 엔트리에 대해 `true`를 반환한다.
- [ ] `isCacheStale`이 잘못된 `lastCheckedAt` 값에 대해 `true`를 반환한다.
- [ ] `clearCache`가 캐시 파일을 삭제하고, 없는 파일에 대해서는 에러 없이 완료된다.
- [ ] `getDefaultCacheDir`가 Unix에서 XDG 경로, Windows에서 LOCALAPPDATA를 반환한다.
- [ ] `spawnBackgroundCheck`가 호출자를 block하지 않고, 에러가 발생해도 throw하지 않는다.
- [ ] 모든 테스트가 통과한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 캐시 단위 테스트
npx vitest run tests/checker/cache.test.ts

# 3. 백그라운드 체크 테스트
npx vitest run tests/checker/background.test.ts

# 4. 플랫폼 경로 테스트
npx vitest run tests/platform/paths.test.ts

# 5. 원자적 쓰기 검증 — 임시 파일 잔류 확인
npx vitest run tests/checker/cache.test.ts -t "atomic write"

# 6. 손상 캐시 복구 테스트
npx vitest run tests/checker/cache.test.ts -t "corrupt cache"

# 7. 커버리지 확인 (cache 모듈 90% 이상)
npx vitest run tests/checker/ --coverage

# 8. 수동 검증 — 캐시 파일 구조 확인
node -e "
const { writeCache, readCache } = require('./dist/index.cjs');
// writeCache 후 파일 내용이 유효한 JSON인지 확인
"
```
