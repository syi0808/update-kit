# Task 13: 하드닝 + 크로스플랫폼

## 목표

프로덕션 수준의 안정성과 보안을 달성한다. Windows를 포함한 크로스플랫폼 지원을 완성하고, 프록시 환경 대응, 동시 접근 안전성, 에러 복구, 보안 감사를 수행한다. GitHub Actions CI를 구성하여 3개 플랫폼(Linux, macOS, Windows)에서 자동 테스트를 실행한다.

## 선행 태스크

- Task 12: 데모 CLI

## 구현 상세

### 1. Windows 바이너리 교체

Windows에서는 실행 중인 `.exe` 파일을 직접 덮어쓸 수 없다. 기존 파일을 `.old`로 이름을 변경한 뒤 새 파일을 배치하는 전략을 사용한다.

```typescript
// src/applier/platform/replace.ts (Windows 분기)

import { rename, copyFile, unlink, chmod } from 'node:fs/promises';
import { platform } from 'node:os';

/**
 * 실행 중인 바이너리를 새 파일로 교체한다.
 * Windows에서는 파일 잠금 문제를 우회하기 위해 rename 전략을 사용한다.
 */
export async function replaceBinary(
  currentPath: string,
  newPath: string,
): Promise<void> {
  if (platform() === 'win32') {
    await replaceWindows(currentPath, newPath);
  } else {
    await replacePosix(currentPath, newPath);
  }
}

async function replaceWindows(currentPath: string, newPath: string): Promise<void> {
  const oldPath = `${currentPath}.old`;

  // 1. 이전 .old 파일이 있으면 삭제 시도 (이전 업데이트 잔재)
  try {
    await unlink(oldPath);
  } catch {
    // 무시: 파일이 없을 수 있다
  }

  // 2. 현재 실행 파일을 .old로 이름 변경 (Windows에서 실행 중 rename은 가능)
  await rename(currentPath, oldPath);

  // 3. 새 파일을 원래 경로로 이동
  try {
    await rename(newPath, currentPath);
  } catch (err) {
    // 실패 시 롤백: .old를 원래 이름으로 복원
    await rename(oldPath, currentPath);
    throw err;
  }

  // 4. .old 파일 정리 예약 (다음 실행 시 또는 지연 삭제)
  scheduleCleanup(oldPath);
}

async function replacePosix(currentPath: string, newPath: string): Promise<void> {
  // POSIX에서는 rename이 atomic하게 동작
  await rename(newPath, currentPath);
  await chmod(currentPath, 0o755);
}

function scheduleCleanup(oldPath: string): void {
  // 다음 실행 시 .old 파일 삭제를 시도하도록 마커 파일 생성
  // 또는 setTimeout으로 지연 삭제 (프로세스가 유지되는 경우)
  setTimeout(async () => {
    try {
      await unlink(oldPath);
    } catch {
      // 삭제 실패는 무시 (다음 업데이트 시 정리됨)
    }
  }, 5000);
}
```

CI에서 `windows-latest` 러너로 바이너리 교체 테스트를 수행한다.

### 2. 프록시 지원

`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` 환경 변수를 존중한다.

```typescript
// src/utils/http.ts 확장

import { Agent } from 'node:https';

/**
 * 환경 변수에서 프록시 설정을 읽어 적절한 fetch 옵션을 반환한다.
 * Node.js 18+의 내장 fetch와 함께 사용한다.
 */
export function getProxyConfig(url: string): { dispatcher?: unknown } | undefined {
  const parsedUrl = new URL(url);
  const noProxy = process.env['NO_PROXY'] || process.env['no_proxy'];

  // NO_PROXY에 해당하는 호스트는 프록시를 사용하지 않는다
  if (noProxy && shouldBypass(parsedUrl.hostname, noProxy)) {
    return undefined;
  }

  const proxyUrl = parsedUrl.protocol === 'https:'
    ? (process.env['HTTPS_PROXY'] || process.env['https_proxy'])
    : (process.env['HTTP_PROXY'] || process.env['http_proxy']);

  if (!proxyUrl) return undefined;

  // undici ProxyAgent 사용 (Node.js 내장)
  // 동적 import로 lazy loading
  return { dispatcher: createProxyAgent(proxyUrl) };
}

function shouldBypass(hostname: string, noProxy: string): boolean {
  const entries = noProxy.split(',').map(e => e.trim().toLowerCase());
  const host = hostname.toLowerCase();

  for (const entry of entries) {
    if (entry === '*') return true;
    if (host === entry) return true;
    if (entry.startsWith('.') && host.endsWith(entry)) return true;
  }
  return false;
}

async function createProxyAgent(proxyUrl: string): Promise<unknown> {
  const { ProxyAgent } = await import('undici');
  return new ProxyAgent(proxyUrl);
}
```

테스트에서는 mock 프록시 서버를 사용하여 프록시 경유 요청이 올바르게 동작하는지 확인한다.

### 3. 동시 접근 안전성

캐시 파일에 대한 동시 접근 시 데이터 손상을 방지한다.

```typescript
// src/utils/fs.ts 확장

import { writeFile, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/**
 * 원자적 파일 쓰기를 수행한다.
 * 임시 파일에 먼저 쓴 뒤 rename하여 부분 쓰기를 방지한다.
 * 고유한 임시 파일명을 사용하여 동시 접근 충돌을 방지한다.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
): Promise<void> {
  const dir = dirname(filePath);
  const tmpName = `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`;
  const tmpPath = join(dir, tmpName);

  try {
    // 제한적 권한으로 임시 파일 작성
    await writeFile(tmpPath, data, { mode: 0o600 });
    // atomic rename
    await rename(tmpPath, filePath);
  } catch (err) {
    // 실패 시 임시 파일 정리
    try {
      await unlink(tmpPath);
    } catch {
      // 정리 실패는 무시
    }
    throw err;
  }
}
```

임시 파일 네이밍 규칙: `{name}.{pid}.{timestamp}.tmp`
- `pid`: 프로세스 ID로 동일 머신의 다른 프로세스와 구분
- `timestamp`: 같은 프로세스 내 여러 호출 구분

선택사항: 장시간 실행되는 작업(다운로드 등)에는 advisory file lock을 사용할 수 있다.

### 4. 에러 복구

모든 실패 경로에서 graceful degradation을 보장한다.

```typescript
// src/utils/http.ts - 네트워크 타임아웃 처리

/**
 * 타임아웃이 적용된 fetch를 수행한다.
 * AbortController를 사용하여 지정된 시간 내에 응답이 없으면 요청을 중단한다.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new UpdateKitError('NETWORK_ERROR', `Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

에러 복구 체크리스트:
- **네트워크 타임아웃**: `AbortController`로 설정 가능한 타임아웃 (기본 30초)
- **부분 다운로드 정리**: 다운로드 실패 시 임시 파일을 삭제하고, 캐시를 오염시키지 않는다
- **손상된 아카이브 감지**: 체크섬 검증을 통해 손상된 파일을 거부한다
- **모든 실패 경로의 Graceful degradation**: 업데이트 실패가 애플리케이션 실행을 방해하지 않는다

```typescript
// 아카이브 무결성 검증 예시
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function verifyChecksum(
  filePath: string,
  expected: string,
  algorithm: string = 'sha256',
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      resolve(actual === expected.toLowerCase());
    });
    stream.on('error', reject);
  });
}
```

### 5. CI 설정 (GitHub Actions)

3개 플랫폼에서 자동으로 lint, test, build를 실행하는 CI 워크플로우를 구성한다.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20, 22]
      fail-fast: false

    runs-on: ${{ matrix.os }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint (type check)
        run: npm run lint

      - name: Run tests with coverage
        run: npx vitest run --coverage

      - name: Build
        run: npm run build

      - name: Upload coverage
        if: matrix.os == 'ubuntu-latest' && matrix.node-version == 22
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/
```

### 6. 성능 최적화

시작 시간과 런타임 성능에 영향을 최소화한다.

```typescript
// Lazy module loading 예시
// 아카이브 추출 등 선택적 기능은 필요할 때만 로드한다

export async function extractArchive(
  archivePath: string,
  destDir: string,
): Promise<void> {
  // 동적 import로 필요 시점에만 모듈을 로드한다
  const { extract } = await import('./archive.js');
  await extract(archivePath, destDir);
}
```

성능 목표:
- **백그라운드 체크**: 앱 시작 시간에 5ms 미만 추가
- **캐시 읽기**: 1ms 미만
- **선택적 모듈**: lazy loading으로 불필요한 모듈의 초기 로드 방지

### 7. 보안 감사

프로덕션 배포 전 수행해야 할 보안 점검 항목:

```typescript
// 보안 검증 예시

// 1. 명령 주입 방지: spawn에 배열 인자를 사용하고, shell 옵션을 사용하지 않는다
import { spawn } from 'node:child_process';

function safeExec(command: string, args: string[]): void {
  // 올바른 방법: 배열 인자로 전달
  spawn(command, args, { shell: false });

  // 절대 하지 말 것: 문자열 결합으로 shell 실행
  // spawn(`${command} ${args.join(' ')}`, { shell: true }); // 위험!
}

// 2. TLS 강제: http:// URL 거부
function validateDownloadUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new UpdateKitError(
      'NETWORK_ERROR',
      `Insecure download URL rejected: ${url}. Only HTTPS is allowed.`,
    );
  }
}

// 3. 임시 파일 권한: 0o600 (소유자만 읽기/쓰기)
// atomicWriteFile에서 이미 적용됨

// 4. 캐시 파일에 비밀 정보 미포함: 캐시에는 버전 정보만 저장
```

보안 감사 체크리스트:
- [ ] 위임 명령어에 `shell: true` 사용하지 않음 (`spawn`에 배열 인자 사용)
- [ ] 다운로드 URL에 TLS 강제 (`https://`만 허용)
- [ ] 임시 파일 권한 제한 (`0o600`)
- [ ] 캐시 파일에 비밀 정보(토큰, 키 등)가 저장되지 않음
- [ ] 환경 변수에서 읽은 프록시 URL의 유효성 검증
- [ ] 체크섬 검증 시 timing-safe 비교 사용 고려

## 생성/수정 파일

| 파일 | 작업 | 설명 |
|------|------|------|
| `.github/workflows/ci.yml` | 생성 | GitHub Actions CI 워크플로우 |
| `src/applier/platform/replace.ts` | 수정 | Windows 바이너리 교체 전략 추가 |
| `src/utils/http.ts` | 수정 | 프록시 지원 및 타임아웃 처리 추가 |
| `src/utils/fs.ts` | 수정 | 원자적 파일 쓰기 개선 (고유 임시 파일명) |
| `src/utils/security.ts` | 생성 | URL 검증, 체크섬 검증 유틸리티 |
| `src/__tests__/platform.test.ts` | 생성 | 크로스플랫폼 테스트 |
| `src/__tests__/proxy.test.ts` | 생성 | 프록시 지원 테스트 |
| `src/__tests__/security.test.ts` | 생성 | 보안 검증 테스트 |

## 완료 기준

- [ ] Windows에서 바이너리 교체가 파일 잠금 없이 동작한다 (CI에서 검증).
- [ ] `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` 환경 변수가 올바르게 처리된다.
- [ ] 동시 접근 시 캐시 파일이 손상되지 않는다 (atomic write + 고유 tmp 파일명).
- [ ] 네트워크 타임아웃, 부분 다운로드, 손상된 아카이브에 대해 graceful degradation이 동작한다.
- [ ] GitHub Actions CI가 Linux, macOS, Windows에서 모두 통과한다.
- [ ] 백그라운드 체크가 앱 시작 시간에 5ms 미만을 추가한다.
- [ ] 캐시 읽기가 1ms 미만으로 완료된다.
- [ ] 보안 감사 체크리스트의 모든 항목이 통과한다.
- [ ] `tsc --noEmit`이 에러 없이 통과한다.
- [ ] `npm run build`가 성공한다.

## 검증 방법

```bash
# 1. 로컬 테스트 (현재 플랫폼)
npm test

# 2. 타입 검사
npx tsc --noEmit

# 3. 빌드
npm run build

# 4. 커버리지 확인
npx vitest run --coverage
```

CI를 통한 크로스플랫폼 검증:

```bash
# GitHub Actions에서 3개 플랫폼 x 3개 Node 버전 = 9개 조합 테스트
# push 또는 PR 시 자동 실행
git push origin feature/hardening
# → GitHub Actions에서 ci.yml 워크플로우 실행 확인
```

수동 보안 검토 체크리스트:

```bash
# 1. 명령 주입 확인: shell: true 사용 여부 검색
grep -r "shell.*true" src/

# 2. HTTP URL 확인: http:// 리터럴 검색 (테스트 제외)
grep -r "http://" src/ --include="*.ts" | grep -v test | grep -v "HTTP_PROXY"

# 3. 파일 권한 확인: 0o600 이외의 권한 사용 여부 검색
grep -r "mode:" src/ --include="*.ts"

# 4. 캐시 내용 확인: 민감 정보 저장 여부 검토
cat $(find . -name "*.cache.json" -path "*/test/*")
```
