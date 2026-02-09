# Task 03: 설치 채널 감지

## 목표

CLI 앱의 실행 파일 경로를 기반으로 설치 채널(native, brew-cask, npm-global, unmanaged)을 감지하는 시스템을 구현한다. 각 감지 결과에는 채널, 신뢰도(confidence), 판단 근거(evidence)가 포함되어야 한다.

## 선행 태스크

- Task 02: 핵심 타입 정의

## 구현 상세

### 감지 전략 개요

감지기는 우선순위 순서대로 실행되며, 가장 높은 신뢰도의 결과를 반환한다.

```
우선순위: receipt (명시적) → brew (경로 + 명령어) → npm (경로 + 심볼릭 링크) → unmanaged (폴백)
```

입력으로 `process.execPath` 또는 사용자 제공 경로를 받으며, 심볼릭 링크는 `fs.realpath`로 해석한 실제 경로를 사용한다.

### 1. src/detection/receipt.ts - 설치 영수증 기반 감지

설정 가능한 경로(기본값: `~/.config/{appName}/install-receipt.json`)에 영수증 파일이 존재하는지 확인한다. 영수증은 네이티브 설치 시 설치기가 남기는 파일이다.

```typescript
import type { InstallDetection } from '../types.js';
import type { UpdateKitConfig } from '../config.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface InstallReceipt {
  appName: string;
  channel: string;
  installedAt?: string;
  version?: string;
}

/**
 * 설치 영수증 파일을 확인하여 채널을 감지한다.
 * 영수증이 존재하고, JSON 형식이 유효하며, appName이 일치하면
 * 'native' 채널 + 'high' 신뢰도를 반환한다.
 */
export async function detectFromReceipt(
  config: Pick<UpdateKitConfig, 'appName'>,
  receiptDir?: string,
): Promise<InstallDetection | null> {
  const dir = receiptDir ?? join(homedir(), '.config', config.appName);
  const receiptPath = join(dir, 'install-receipt.json');

  try {
    const content = await readFile(receiptPath, 'utf-8');
    const receipt: InstallReceipt = JSON.parse(content);

    if (receipt.appName !== config.appName) {
      return null;
    }

    return {
      channel: receipt.channel ?? 'native',
      confidence: 'high',
      evidence: [
        {
          source: 'receipt_file',
          detail: `영수증 파일 발견: ${receiptPath}`,
        },
      ],
    };
  } catch {
    // 파일이 없거나 파싱 실패 → 이 감지기로는 판단 불가
    return null;
  }
}
```

### 2. src/detection/brew.ts - Homebrew 기반 감지

실행 파일 경로에 Homebrew 관련 패턴이 포함되어 있는지 확인하고, 선택적으로 `brew list --cask` 명령어를 실행하여 신뢰도를 높인다.

```typescript
import type { InstallDetection, Evidence } from '../types.js';
import type { UpdateKitConfig } from '../config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Homebrew 관련 경로 패턴 */
const BREW_PATH_PATTERNS = [
  '/opt/homebrew/',
  '/usr/local/Caskroom/',
  '/usr/local/Cellar/',
  '/home/linuxbrew/',
];

/**
 * 실행 파일 경로가 Homebrew 경로 패턴과 일치하는지 확인한다.
 * 일치하면 medium 신뢰도로 반환하고, brew list --cask 확인에
 * 성공하면 high 신뢰도로 승격한다.
 */
export async function detectFromBrew(
  execPath: string,
  config: Pick<UpdateKitConfig, 'brewCaskName'>,
): Promise<InstallDetection | null> {
  const matchedPattern = BREW_PATH_PATTERNS.find((pattern) =>
    execPath.includes(pattern),
  );

  if (!matchedPattern) {
    return null;
  }

  const evidence: Evidence[] = [
    {
      source: 'path_pattern',
      detail: `실행 경로가 Homebrew 패턴과 일치: ${matchedPattern}`,
    },
  ];

  let confidence: 'medium' | 'high' = 'medium';

  // brew list --cask으로 신뢰도 승격 시도
  if (config.brewCaskName) {
    try {
      await execFileAsync('brew', ['list', '--cask', config.brewCaskName]);
      confidence = 'high';
      evidence.push({
        source: 'brew_list',
        detail: `brew list --cask ${config.brewCaskName} 확인 성공`,
      });
    } catch {
      // brew 명령 실패 → medium 신뢰도 유지
      evidence.push({
        source: 'brew_list',
        detail: `brew list --cask 확인 실패, 경로 패턴만으로 판단`,
      });
    }
  }

  return {
    channel: 'brew-cask',
    confidence,
    evidence,
  };
}
```

### 3. src/detection/npm.ts - npm global 감지

실행 파일 경로가 `node_modules/.bin/` 하위에 있거나, npm global prefix 경로와 일치하는지 확인한다.

```typescript
import type { InstallDetection, Evidence } from '../types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readlink } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

/** npm global 설치 관련 경로 패턴 */
const NPM_PATH_PATTERNS = [
  'node_modules/.bin/',
  '/lib/node_modules/',
];

/**
 * 실행 파일 경로가 npm global 설치 패턴과 일치하는지 확인한다.
 * 1. 경로에 node_modules 패턴이 포함되어 있는지 확인
 * 2. npm prefix -g 결과와 경로를 비교
 * 3. 심볼릭 링크 여부를 확인하여 npm link 감지
 */
export async function detectFromNpm(
  execPath: string,
): Promise<InstallDetection | null> {
  const evidence: Evidence[] = [];

  // 1. 경로 패턴 매칭
  const matchedPattern = NPM_PATH_PATTERNS.find((pattern) =>
    execPath.includes(pattern),
  );

  if (matchedPattern) {
    evidence.push({
      source: 'path_pattern',
      detail: `실행 경로가 npm 패턴과 일치: ${matchedPattern}`,
    });
  }

  // 2. npm prefix -g 비교
  try {
    const { stdout } = await execFileAsync('npm', ['prefix', '-g']);
    const globalPrefix = stdout.trim();
    if (execPath.startsWith(globalPrefix)) {
      evidence.push({
        source: 'npm_prefix',
        detail: `실행 경로가 npm global prefix 하위: ${globalPrefix}`,
      });
    }
  } catch {
    // npm 명령 실행 실패 → 무시
  }

  // 3. 심볼릭 링크 확인 (npm link로 설치된 경우)
  try {
    const stats = await lstat(execPath);
    if (stats.isSymbolicLink()) {
      const target = await readlink(execPath);
      if (target.includes('node_modules')) {
        evidence.push({
          source: 'symlink',
          detail: `심볼릭 링크 대상이 node_modules 포함: ${target}`,
        });
      }
    }
  } catch {
    // 심볼릭 링크 확인 실패 → 무시
  }

  if (evidence.length === 0) {
    return null;
  }

  // 근거 수에 따라 신뢰도 결정
  const confidence = evidence.length >= 2 ? 'high' : 'medium';

  return {
    channel: 'npm-global',
    confidence,
    evidence,
  };
}
```

### 4. src/detection/heuristics.ts - 경로 기반 휴리스틱

알려진 설치 경로 패턴을 기반으로 추가 힌트를 제공하는 보조 감지기이다.

```typescript
import type { Evidence } from '../types.js';

/** 알려진 시스템 경로 패턴과 그에 대한 힌트 */
const PATH_HINTS: Array<{ pattern: string; hint: string }> = [
  { pattern: '/usr/local/bin/', hint: '시스템 로컬 바이너리 경로' },
  { pattern: '/usr/bin/', hint: '시스템 바이너리 경로' },
  { pattern: '/snap/', hint: 'Snap 패키지 경로' },
  { pattern: '/flatpak/', hint: 'Flatpak 패키지 경로' },
  { pattern: '/.local/bin/', hint: '사용자 로컬 바이너리 경로' },
  { pattern: '/AppData/', hint: 'Windows AppData 경로' },
  { pattern: '/Applications/', hint: 'macOS 애플리케이션 경로' },
];

/**
 * 실행 파일 경로에서 추가적인 힌트를 수집한다.
 * 이 함수는 단독으로 채널을 결정하지 않으며,
 * 다른 감지기의 보조 근거로 사용된다.
 */
export function collectPathHeuristics(execPath: string): Evidence[] {
  const evidence: Evidence[] = [];

  for (const { pattern, hint } of PATH_HINTS) {
    if (execPath.includes(pattern)) {
      evidence.push({
        source: 'path_pattern',
        detail: hint,
      });
    }
  }

  return evidence;
}
```

### 5. src/detection/index.ts - 감지 오케스트레이터

모든 감지기를 우선순위 순서대로 실행하고, 가장 적합한 결과를 반환하는 메인 함수이다.

```typescript
import type { InstallDetection } from '../types.js';
import type { UpdateKitConfig } from '../config.js';
import { realpath } from 'node:fs/promises';
import { detectFromReceipt } from './receipt.js';
import { detectFromBrew } from './brew.js';
import { detectFromNpm } from './npm.js';
import { collectPathHeuristics } from './heuristics.js';

/**
 * 설치 채널을 감지한다.
 *
 * 감지 우선순위:
 * 1. 설치 영수증 (receipt) → 명시적 기록이므로 최우선
 * 2. Homebrew 패턴 → 경로 + 명령어 확인
 * 3. npm global 패턴 → 경로 + prefix + 심볼릭 링크
 * 4. 폴백: unmanaged
 *
 * @param execPath - 실행 파일 경로. 기본값: process.execPath
 * @param config - 앱 설정 (appName 필수)
 * @returns 감지 결과 (채널, 신뢰도, 근거)
 */
export async function detectInstall(
  execPath: string,
  config: Pick<UpdateKitConfig, 'appName' | 'brewCaskName'>,
): Promise<InstallDetection> {
  // 심볼릭 링크를 해석하여 실제 경로를 얻는다
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(execPath);
  } catch {
    resolvedPath = execPath;
  }

  // 1. 설치 영수증 확인
  const receiptResult = await detectFromReceipt(config);
  if (receiptResult) {
    return receiptResult;
  }

  // 2. Homebrew 확인
  const brewResult = await detectFromBrew(resolvedPath, config);
  if (brewResult) {
    return brewResult;
  }

  // 3. npm global 확인
  const npmResult = await detectFromNpm(resolvedPath);
  if (npmResult) {
    return npmResult;
  }

  // 4. 폴백: unmanaged
  const heuristicEvidence = collectPathHeuristics(resolvedPath);
  return {
    channel: 'unmanaged',
    confidence: heuristicEvidence.length > 0 ? 'low' : 'none',
    evidence: [
      {
        source: 'fallback',
        detail: '알려진 설치 채널 패턴과 일치하지 않음',
      },
      ...heuristicEvidence,
    ],
  };
}

export { detectFromReceipt } from './receipt.js';
export { detectFromBrew } from './brew.js';
export { detectFromNpm } from './npm.js';
export { collectPathHeuristics } from './heuristics.js';
```

## 생성/수정 파일

| 파일 | 작업 | 설명 |
|------|------|------|
| `src/detection/receipt.ts` | 생성 | 설치 영수증 기반 감지 |
| `src/detection/brew.ts` | 생성 | Homebrew 경로 및 명령어 기반 감지 |
| `src/detection/npm.ts` | 생성 | npm global 경로 및 심볼릭 링크 기반 감지 |
| `src/detection/heuristics.ts` | 생성 | 경로 기반 휴리스틱 보조 감지 |
| `src/detection/index.ts` | 생성 | 감지 오케스트레이터 메인 함수 |
| `src/index.ts` | 수정 | `detectInstall` 함수 re-export 추가 |

## 완료 기준

- [ ] `detectInstall()` 함수가 `InstallDetection` 타입을 반환한다.
- [ ] 영수증 파일이 존재하면 `native` + `high` 신뢰도를 반환한다.
- [ ] Homebrew 경로 패턴이 일치하면 `brew-cask` + `medium` 이상 신뢰도를 반환한다.
- [ ] npm 패턴이 일치하면 `npm-global` + `medium` 이상 신뢰도를 반환한다.
- [ ] 어떤 패턴도 일치하지 않으면 `unmanaged` + `none` 또는 `low` 신뢰도로 폴백한다.
- [ ] 심볼릭 링크가 `fs.realpath`로 올바르게 해석된다.
- [ ] 모든 감지기가 에러를 throw하지 않고 `null`을 반환하여 다음 감지기로 넘긴다.
- [ ] 단위 테스트가 모든 채널에 대해 통과한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 빌드
npm run build

# 3. 단위 테스트 실행
npm test -- src/detection/
```

아래 테스트를 작성하여 감지 로직을 검증한다.

```typescript
// src/detection/__tests__/detection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectInstall } from '../index.js';

// fs 모듈 모킹
vi.mock('node:fs/promises', () => ({
  realpath: vi.fn((p: string) => Promise.resolve(p)),
  readFile: vi.fn(),
  lstat: vi.fn(),
  readlink: vi.fn(),
}));

// child_process 모듈 모킹
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('detectInstall', () => {
  const config = { appName: 'test-app' };

  it('영수증 파일이 존재하면 native + high를 반환한다', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ appName: 'test-app', channel: 'native' }),
    );

    const result = await detectInstall('/usr/local/bin/test-app', config);
    expect(result.channel).toBe('native');
    expect(result.confidence).toBe('high');
  });

  it('Homebrew 경로이면 brew-cask를 반환한다', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));

    const result = await detectInstall(
      '/opt/homebrew/Caskroom/test-app/1.0/test-app',
      config,
    );
    expect(result.channel).toBe('brew-cask');
    expect(result.confidence).toBe('medium');
  });

  it('npm 경로이면 npm-global을 반환한다', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));

    const result = await detectInstall(
      '/usr/local/lib/node_modules/.bin/test-app',
      config,
    );
    expect(result.channel).toBe('npm-global');
  });

  it('알 수 없는 경로이면 unmanaged로 폴백한다', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));

    const result = await detectInstall('/some/random/path/test-app', config);
    expect(result.channel).toBe('unmanaged');
  });
});
```
