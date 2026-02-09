# Task 08: 업데이트 적용 - Native In-Place

## 목표

릴리스 에셋을 다운로드하고, 체크섬을 검증한 뒤, 현재 실행 중인 바이너리를 원자적으로 교체하는 네이티브 업데이트 적용기를 구현한다. 보안(TLS, 체크섬 필수), 안전성(원자적 교체, 롤백), 사용성(진행률 콜백, AbortSignal)을 모두 갖춘다.

## 선행 태스크

- Task 07 (업데이트 플래너) — `UpdatePlan`의 `native-in-place` 타입 정의

## 구현 상세

### 1. 인터페이스 정의

```typescript
// src/applier/native.ts

import type { UpdatePlan, AssetInfo, PostAction } from '../planner';

export interface ApplyOptions {
  /** 다운로드 진행률 콜백 */
  onProgress?: (progress: ApplyProgress) => void;

  /** 취소 시그널 */
  signal?: AbortSignal;

  /** 체크섬 검증 생략 (비권장, 기본값: false) */
  skipChecksum?: boolean;

  /** 선택적 서명 검증 키 */
  signatureKey?: string;
}

export interface ApplyProgress {
  phase: 'download' | 'verify' | 'extract' | 'replace';
  /** 0.0 ~ 1.0, 알 수 없으면 undefined */
  fraction?: number;
  /** 다운로드된 바이트 수 */
  bytesDownloaded?: number;
  /** 전체 바이트 수 (Content-Length가 있는 경우) */
  totalBytes?: number;
}

export interface ApplyResult {
  success: true;
  postAction: PostAction;
  fromVersion: string;
  toVersion: string;
}
```

### 2. 메인 적용 함수

```typescript
export async function applyNativeUpdate(
  plan: UpdatePlan & { kind: { type: 'native-in-place' } },
  targetPath: string,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const { kind } = plan;
  const { asset, postAction } = kind;
  const { onProgress, signal, skipChecksum = false } = options;

  // 임시 디렉터리 — 대상과 같은 파일시스템에 위치
  const tmpDir = await createTempDir(targetPath);

  try {
    // 1. 다운로드
    const downloadedPath = await downloadArtifact(
      asset.url,
      tmpDir,
      { onProgress, signal },
    );

    // 2. 체크섬 검증
    if (!skipChecksum) {
      await verifyChecksum(downloadedPath, asset, { onProgress, signal });
    }

    // 3. 아카이브 추출
    const binaryPath = await extractBinary(
      downloadedPath,
      tmpDir,
      { onProgress },
    );

    // 4. 권한 설정 (Unix)
    if (process.platform !== 'win32') {
      await setExecutablePermission(binaryPath);
    }

    // 5. 원자적 교체
    onProgress?.({ phase: 'replace' });
    await atomicReplace(binaryPath, targetPath);

    return {
      success: true,
      postAction,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
    };
  } finally {
    // 임시 파일 정리 — 성공/실패 모두
    await cleanupTempDir(tmpDir);
  }
}
```

### 3. 다운로드 파이프라인

Native `fetch`의 `ReadableStream`을 사용하여 스트리밍 다운로드하고 진행률을 보고한다.

```typescript
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

async function downloadArtifact(
  url: string,
  tmpDir: string,
  options: { onProgress?: (p: ApplyProgress) => void; signal?: AbortSignal },
): Promise<string> {
  // TLS 강제
  if (!url.startsWith('https://')) {
    throw new UpdateKitError('INSECURE_URL', 'HTTPS가 필수입니다.');
  }

  const response = await fetch(url, { signal: options.signal });

  if (!response.ok) {
    throw new UpdateKitError(
      'DOWNLOAD_FAILED',
      `다운로드 실패: HTTP ${response.status}`,
    );
  }

  if (!response.body) {
    throw new UpdateKitError('DOWNLOAD_FAILED', '응답 본문이 비어 있습니다.');
  }

  const totalBytes = Number(response.headers.get('content-length')) || undefined;
  const filename = extractFilename(url);
  const destPath = path.join(tmpDir, filename);

  // ReadableStream → Node Readable → 파일 쓰기 + 진행률 보고
  let bytesDownloaded = 0;
  const nodeStream = Readable.fromWeb(response.body as any);

  const writeStream = createWriteStream(destPath);

  nodeStream.on('data', (chunk: Buffer) => {
    bytesDownloaded += chunk.length;
    options.onProgress?.({
      phase: 'download',
      bytesDownloaded,
      totalBytes,
      fraction: totalBytes ? bytesDownloaded / totalBytes : undefined,
    });
  });

  await pipeline(nodeStream, writeStream);

  return destPath;
}

function extractFilename(url: string): string {
  const urlObj = new URL(url);
  const segments = urlObj.pathname.split('/');
  return segments[segments.length - 1] || 'artifact';
}
```

### 4. 체크섬 검증

SHA-256 해시로 다운로드한 파일의 무결성을 확인한다. 체크섬 소스는 직접 지정 또는 URL에서 다운로드한다.

```typescript
// src/applier/verify.ts

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';

export async function verifyChecksum(
  filePath: string,
  asset: AssetInfo,
  options: { onProgress?: (p: ApplyProgress) => void; signal?: AbortSignal },
): Promise<void> {
  options.onProgress?.({ phase: 'verify' });

  let expectedHash: string;

  if (asset.expectedChecksum) {
    // 직접 지정된 체크섬
    expectedHash = asset.expectedChecksum.toLowerCase();
  } else if (asset.checksumUrl) {
    // 체크섬 파일에서 다운로드
    expectedHash = await fetchChecksumFromUrl(
      asset.checksumUrl,
      asset.filename,
      options.signal,
    );
  } else {
    throw new UpdateKitError(
      'CHECKSUM_MISSING',
      '체크섬이 지정되지 않았습니다. skipChecksum 옵션을 사용하거나 체크섬을 제공하세요.',
    );
  }

  // SHA-256 계산
  const actualHash = await computeSha256(filePath);

  if (actualHash !== expectedHash) {
    throw new UpdateKitError(
      'CHECKSUM_MISMATCH',
      `체크섬 불일치: 예상=${expectedHash}, 실제=${actualHash}`,
    );
  }
}

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 체크섬 URL에서 해시를 가져온다.
 * 일반적인 형식: "{hash}  {filename}" 또는 "{hash} {filename}"
 */
async function fetchChecksumFromUrl(
  checksumUrl: string,
  filename: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(checksumUrl, { signal });
  if (!response.ok) {
    throw new UpdateKitError(
      'CHECKSUM_FETCH_FAILED',
      `체크섬 파일 다운로드 실패: HTTP ${response.status}`,
    );
  }

  const text = await response.text();
  const lines = text.trim().split('\n');

  for (const line of lines) {
    // "sha256hash  filename" 또는 "sha256hash filename" 형식 파싱
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (match && match[2].trim() === filename) {
      return match[1].toLowerCase();
    }
  }

  // 단일 해시만 있는 경우 (파일명 없음)
  if (lines.length === 1 && /^[a-f0-9]{64}$/i.test(lines[0].trim())) {
    return lines[0].trim().toLowerCase();
  }

  throw new UpdateKitError(
    'CHECKSUM_PARSE_FAILED',
    `체크섬 파일에서 ${filename}에 해당하는 해시를 찾을 수 없습니다.`,
  );
}
```

### 5. 아카이브 추출

다운로드한 파일의 확장자를 기반으로 적절한 추출 방식을 선택한다.

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function extractBinary(
  archivePath: string,
  tmpDir: string,
  options: { onProgress?: (p: ApplyProgress) => void },
): Promise<string> {
  options.onProgress?.({ phase: 'extract' });

  const extractDir = path.join(tmpDir, 'extracted');
  await fs.mkdir(extractDir, { recursive: true });

  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    await execFileAsync('tar', ['xzf', archivePath, '-C', extractDir]);
  } else if (archivePath.endsWith('.zip')) {
    // Unix: unzip 사용
    if (process.platform !== 'win32') {
      await execFileAsync('unzip', ['-o', archivePath, '-d', extractDir]);
    } else {
      // Windows: PowerShell Expand-Archive 사용
      await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`,
      ]);
    }
  } else {
    // 아카이브가 아닌 단독 바이너리
    const destPath = path.join(extractDir, path.basename(archivePath));
    await fs.copyFile(archivePath, destPath);
    return destPath;
  }

  // 추출된 바이너리 탐색
  return findBinaryInDir(extractDir);
}

/**
 * 추출된 디렉터리에서 실행 가능한 바이너리를 찾는다.
 * 단일 파일이면 그것을 반환하고, 여러 파일이면 실행 권한이 있는 것을 선택한다.
 */
async function findBinaryInDir(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath ?? e.path, e.name));

  if (files.length === 0) {
    throw new UpdateKitError('EXTRACT_FAILED', '추출된 바이너리를 찾을 수 없습니다.');
  }

  if (files.length === 1) {
    return files[0];
  }

  // 여러 파일 중 실행 권한이 있는 것 선택
  for (const file of files) {
    try {
      await fs.access(file, fs.constants.X_OK);
      return file;
    } catch {
      continue;
    }
  }

  // 실행 권한이 있는 파일이 없으면 첫 번째 파일 반환
  return files[0];
}
```

### 6. 권한 설정

```typescript
async function setExecutablePermission(filePath: string): Promise<void> {
  await fs.chmod(filePath, 0o755);
}
```

### 7. 원자적 바이너리 교체

```typescript
// src/platform/replace.ts

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 바이너리를 원자적으로 교체한다.
 *
 * Unix: fs.rename은 같은 파일시스템 내에서 원자적이다.
 *       따라서 새 바이너리를 대상과 같은 파일시스템의 임시 위치에 두고 rename한다.
 *
 * Windows: 실행 중인 exe는 rename 가능하지만 삭제 불가.
 *          현재 exe를 .old로 이름 변경 → 새 파일을 대상 위치로 이동 → .old 정리 예약
 */
export async function atomicReplace(
  newPath: string,
  targetPath: string,
): Promise<void> {
  // 대상 파일 쓰기 권한 확인
  try {
    await fs.access(targetPath, fs.constants.W_OK);
  } catch {
    throw new UpdateKitError(
      'PERMISSION_DENIED',
      `쓰기 권한이 없습니다: ${targetPath}. 적절한 권한으로 다시 실행하세요.`,
    );
  }

  if (process.platform === 'win32') {
    await windowsReplace(newPath, targetPath);
  } else {
    await unixReplace(newPath, targetPath);
  }
}

async function unixReplace(newPath: string, targetPath: string): Promise<void> {
  // 같은 디렉터리에 임시 이름으로 복사 (같은 파일시스템 보장)
  const tmpInPlace = targetPath + `.new.${process.pid}`;
  await fs.copyFile(newPath, tmpInPlace);
  await fs.chmod(tmpInPlace, 0o755);

  // 원자적 교체
  await fs.rename(tmpInPlace, targetPath);
}

async function windowsReplace(newPath: string, targetPath: string): Promise<void> {
  const backupPath = targetPath + '.old';

  // 이전 백업 정리
  try {
    await fs.unlink(backupPath);
  } catch {
    // 무시
  }

  // 현재 exe → .old
  await fs.rename(targetPath, backupPath);

  try {
    // 새 파일 → 대상 위치
    await fs.copyFile(newPath, targetPath);
  } catch (error) {
    // 롤백: .old → 원래 위치
    await fs.rename(backupPath, targetPath);
    throw error;
  }

  // .old 정리 시도 (Windows에서는 실행 중이면 실패할 수 있음)
  try {
    await fs.unlink(backupPath);
  } catch {
    // 다음 업데이트 시 정리됨
  }
}
```

### 8. 임시 디렉터리 관리

```typescript
import os from 'node:os';

/**
 * 대상 경로와 같은 파일시스템에 임시 디렉터리를 생성한다.
 * 같은 파일시스템이어야 rename이 원자적으로 동작한다.
 */
async function createTempDir(targetPath: string): Promise<string> {
  const targetDir = path.dirname(targetPath);
  const tmpDir = path.join(targetDir, `.update-kit-tmp-${process.pid}-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

async function cleanupTempDir(tmpDir: string): Promise<void> {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // 정리 실패는 무시 — 다음 실행 시 정리 가능
  }
}
```

### 9. 보안 불변량

- **TLS 강제**: `fetch`는 항상 HTTPS URL만 허용한다. HTTP URL은 에러를 발생시킨다.
- **체크섬 필수**: 기본적으로 SHA-256 체크섬 검증이 필수이다. `skipChecksum` 옵션으로 우회 가능하나 비권장.
- **sudo 미사용**: 권한이 부족하면 에러를 반환한다. 자동으로 권한 상승하지 않는다.
- **임시 파일 정리**: `try/finally`로 성공/실패 모두 임시 파일을 정리한다.
- **롤백 안전성**: `rename`은 원자적이므로, 실패 시 원본 바이너리가 손상되지 않는다.

## 생성/수정 파일

| 파일 | 작업 |
|------|------|
| `src/applier/native.ts` | 생성 — `applyNativeUpdate`, 다운로드, 추출, 교체 로직 |
| `src/applier/verify.ts` | 생성 — `verifyChecksum`, `computeSha256`, 체크섬 파싱 |
| `src/platform/replace.ts` | 생성 — `atomicReplace`, Unix/Windows 교체 로직 |
| `src/applier/types.ts` | 생성 — `ApplyOptions`, `ApplyProgress`, `ApplyResult` 타입 |
| `tests/applier/native.test.ts` | 생성 — 통합 테스트 (임시 디렉터리, Mock HTTP 서버) |
| `tests/applier/verify.test.ts` | 생성 — 체크섬 검증 테스트 |
| `tests/platform/replace.test.ts` | 생성 — 원자적 교체 테스트 |

## 완료 기준

- [ ] HTTPS URL에서 에셋을 스트리밍 다운로드하고, `onProgress` 콜백으로 진행률을 보고한다.
- [ ] HTTP URL을 거부하고 `INSECURE_URL` 에러를 반환한다.
- [ ] SHA-256 체크섬이 일치하면 통과, 불일치하면 `CHECKSUM_MISMATCH` 에러를 반환한다.
- [ ] `expectedChecksum` 직접 지정과 `checksumUrl`에서 다운로드 두 방식 모두 동작한다.
- [ ] `.tar.gz`와 `.zip` 아카이브를 올바르게 추출한다.
- [ ] 추출된 디렉터리에서 실행 가능한 바이너리를 자동 탐색한다.
- [ ] Unix에서 `fs.rename`으로 원자적 교체를 수행한다.
- [ ] Windows에서 rename → copy → cleanup 전략으로 교체한다.
- [ ] 쓰기 권한이 없으면 `PERMISSION_DENIED` 에러를 반환한다 (sudo 미사용).
- [ ] 교체 실패 시 원본 바이너리가 손상되지 않는다 (롤백 안전성).
- [ ] `AbortSignal`로 다운로드를 중간에 취소할 수 있다.
- [ ] 임시 파일이 성공/실패 모두에서 정리된다.
- [ ] 모든 테스트가 통과한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 전체 applier 테스트
npx vitest run tests/applier/

# 3. 다운로드 + 체크섬 통합 테스트 (Mock HTTP 서버 사용)
npx vitest run tests/applier/native.test.ts -t "download and verify"

# 4. 체크섬 실패 테스트
npx vitest run tests/applier/verify.test.ts -t "checksum mismatch"

# 5. 원자적 교체 테스트 (임시 디렉터리에서)
npx vitest run tests/platform/replace.test.ts

# 6. 권한 에러 테스트
npx vitest run tests/applier/native.test.ts -t "permission denied"

# 7. 커버리지 확인 (applier 모듈 80% 이상)
npx vitest run tests/applier/ --coverage

# 8. 수동 엔드투엔드 검증 (테스트용 바이너리)
node -e "
// 가상의 에셋 서버를 띄우고 전체 파이프라인 실행
// 다운로드 → 체크섬 → 추출 → 교체 → 결과 확인
"
```
