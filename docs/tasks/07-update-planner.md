# Task 07: 업데이트 플래너

## 목표

설치 채널 감지 결과(`InstallDetection`)와 업데이트 상태(`UpdateStatus`)를 입력으로 받아, 어떤 방식으로 업데이트를 적용할지 결정하는 정책 엔진(`UpdatePlan`)을 구현한다. 순수 함수로 작성하여 I/O 없이 높은 테스트 용이성을 확보한다.

## 선행 태스크

- Task 02 (타입 시스템) — 공유 타입 정의
- Task 03 (설치 채널 감지) — `InstallDetection` 타입 및 채널 정보
- Task 05 (버전 체커) — `UpdateStatus` 타입

## 구현 상세

### 1. 핵심 타입 정의

```typescript
// src/planner/index.ts

import type { InstallDetection, ChannelKind, Confidence } from '../detection';
import type { UpdateStatus } from '../checker';

/** 업데이트 계획 종류 */
export type PlanKind =
  | { type: 'native-in-place'; asset: AssetInfo; postAction: PostAction }
  | { type: 'delegate-command'; command: string[]; postAction: PostAction }
  | { type: 'manual-install'; message: string; url?: string };

export type PostAction = 'reexec' | 'suggest-restart' | 'exit-after-apply';

export interface AssetInfo {
  url: string;
  filename: string;
  checksumUrl?: string;
  expectedChecksum?: string;
}

export interface UpdatePlan {
  kind: PlanKind;
  fromVersion: string;
  toVersion: string;
  channel: ChannelKind;
}

export interface UpdateKitConfig {
  /** 앱 이름 */
  appName: string;

  /** npm 패키지 이름 (npm 채널용) */
  packageName?: string;

  /** Homebrew cask 이름 (brew 채널용) */
  brewCaskName?: string;

  /** native 바이너리 에셋 매칭 패턴 (정규식 문자열) */
  assetPattern?: string;

  /** reexec 허용 여부 (기본값: false) */
  allowReexec?: boolean;

  /** delegate 모드 (기본값: 'print-only') */
  delegateMode?: 'print-only' | 'execute';

  /** 릴리스 에셋 목록 (VersionSource에서 제공) */
  releaseAssets?: ReleaseAsset[];
}

export interface ReleaseAsset {
  name: string;
  url: string;
  checksumUrl?: string;
}
```

### 2. planUpdate 메인 함수

```typescript
/**
 * (InstallDetection, UpdateStatus) → UpdatePlan
 *
 * 순수 함수 — I/O 없음, 높은 테스트 용이성.
 * UpdateStatus가 'up-to-date' 또는 'unknown'이면 null을 반환한다.
 */
export function planUpdate(
  status: UpdateStatus,
  detection: InstallDetection,
  config: UpdateKitConfig,
): UpdatePlan | null {
  // 업데이트가 필요하지 않은 경우
  if (status.kind !== 'update-available' || !status.latestVersion) {
    return null;
  }

  const { channel, confidence } = detection;
  const toVersion = status.latestVersion;
  const fromVersion = status.currentVersion;

  const kind = resolvePlanKind(channel, confidence, toVersion, config);

  return {
    kind,
    fromVersion,
    toVersion,
    channel,
  };
}
```

### 3. 정책 매트릭스 구현

```typescript
function resolvePlanKind(
  channel: ChannelKind,
  confidence: Confidence,
  toVersion: string,
  config: UpdateKitConfig,
): PlanKind {
  switch (channel) {
    case 'native':
      return resolveNativeChannel(confidence, toVersion, config);

    case 'unmanaged':
      return resolveUnmanagedChannel(confidence, toVersion, config);

    case 'npm-global':
      return resolveNpmChannel(confidence, toVersion, config);

    case 'brew-cask':
      return resolveBrewChannel(confidence, toVersion, config);

    default:
      // 알 수 없는 채널 → manual-install
      return {
        type: 'manual-install',
        message: `알 수 없는 설치 채널(${channel})입니다. 수동으로 업데이트하세요.`,
      };
  }
}
```

### 4. 채널별 정책 함수

#### Native 채널

```typescript
function resolveNativeChannel(
  confidence: Confidence,
  toVersion: string,
  config: UpdateKitConfig,
): PlanKind {
  if (confidence === 'low') {
    return {
      type: 'manual-install',
      message: '설치 채널 감지 신뢰도가 낮습니다. 수동으로 업데이트하세요.',
      url: config.releaseAssets?.[0]?.url,
    };
  }

  const asset = selectAsset(config);

  if (!asset) {
    return {
      type: 'manual-install',
      message: `현재 플랫폼(${process.platform}/${process.arch})에 맞는 에셋을 찾을 수 없습니다.`,
    };
  }

  const postAction = resolveNativePostAction(confidence, config);

  return {
    type: 'native-in-place',
    asset,
    postAction,
  };
}

function resolveNativePostAction(
  confidence: Confidence,
  config: UpdateKitConfig,
): PostAction {
  if (confidence === 'high' && config.allowReexec) {
    return 'reexec';
  }
  return 'suggest-restart';
}
```

#### Unmanaged 채널

```typescript
function resolveUnmanagedChannel(
  confidence: Confidence,
  toVersion: string,
  config: UpdateKitConfig,
): PlanKind {
  if (confidence === 'none') {
    return {
      type: 'manual-install',
      message: '설치 채널을 감지할 수 없습니다. 수동으로 업데이트하세요.',
    };
  }

  const asset = selectAsset(config);

  if (!asset) {
    return {
      type: 'manual-install',
      message: `현재 플랫폼(${process.platform}/${process.arch})에 맞는 에셋을 찾을 수 없습니다.`,
    };
  }

  return {
    type: 'native-in-place',
    asset,
    postAction: 'suggest-restart',
  };
}
```

#### npm 채널

```typescript
function resolveNpmChannel(
  confidence: Confidence,
  toVersion: string,
  config: UpdateKitConfig,
): PlanKind {
  if (confidence === 'low') {
    return {
      type: 'manual-install',
      message: 'npm 설치 감지 신뢰도가 낮습니다. 수동으로 업데이트하세요.',
    };
  }

  const pkg = config.packageName ?? config.appName;

  return {
    type: 'delegate-command',
    command: ['npm', 'install', '-g', `${pkg}@${toVersion}`],
    postAction: 'exit-after-apply',
  };
}
```

#### Homebrew 채널

```typescript
function resolveBrewChannel(
  confidence: Confidence,
  toVersion: string,
  config: UpdateKitConfig,
): PlanKind {
  if (confidence === 'low') {
    return {
      type: 'manual-install',
      message: 'Homebrew 설치 감지 신뢰도가 낮습니다. 수동으로 업데이트하세요.',
    };
  }

  const caskName = config.brewCaskName ?? config.appName;

  return {
    type: 'delegate-command',
    command: ['brew', 'update', '&&', 'brew', 'upgrade', '--cask', caskName],
    postAction: 'exit-after-apply',
  };
}
```

### 5. 에셋 선택 로직

릴리스 에셋 목록에서 현재 플랫폼과 아키텍처에 맞는 에셋을 선택한다.

```typescript
/**
 * 릴리스 에셋에서 현재 플랫폼/아키텍처에 맞는 것을 선택한다.
 *
 * 매칭 우선순위:
 * 1. config.assetPattern 정규식에 매칭되는 에셋
 * 2. 플랫폼/아키텍처 키워드로 자동 매칭
 */
function selectAsset(config: UpdateKitConfig): AssetInfo | null {
  const assets = config.releaseAssets;
  if (!assets || assets.length === 0) return null;

  // 사용자 지정 패턴이 있으면 우선 사용
  if (config.assetPattern) {
    const pattern = new RegExp(config.assetPattern, 'i');
    const match = assets.find((a) => pattern.test(a.name));
    if (match) {
      return {
        url: match.url,
        filename: match.name,
        checksumUrl: match.checksumUrl,
      };
    }
  }

  // 자동 매칭: 플랫폼 + 아키텍처 키워드
  const platformAliases = getPlatformAliases(process.platform);
  const archAliases = getArchAliases(process.arch);

  const match = assets.find((a) => {
    const name = a.name.toLowerCase();
    const matchesPlatform = platformAliases.some((alias) => name.includes(alias));
    const matchesArch = archAliases.some((alias) => name.includes(alias));
    return matchesPlatform && matchesArch;
  });

  if (!match) return null;

  return {
    url: match.url,
    filename: match.name,
    checksumUrl: match.checksumUrl,
  };
}

function getPlatformAliases(platform: string): string[] {
  switch (platform) {
    case 'darwin': return ['darwin', 'macos', 'mac', 'osx', 'apple'];
    case 'linux': return ['linux'];
    case 'win32': return ['win32', 'windows', 'win64', 'win'];
    default: return [platform];
  }
}

function getArchAliases(arch: string): string[] {
  switch (arch) {
    case 'x64': return ['x64', 'x86_64', 'amd64'];
    case 'arm64': return ['arm64', 'aarch64'];
    case 'ia32': return ['ia32', 'x86', 'i386'];
    default: return [arch];
  }
}
```

### 6. 정책 매트릭스 요약

| 채널 | 신뢰도 | 계획 종류 | PostAction |
|------|--------|----------|------------|
| native | high | native-in-place | reexec (allowReexec=true) / suggest-restart |
| native | medium | native-in-place | suggest-restart |
| native | low | manual-install | - |
| unmanaged | low 이상 | native-in-place | suggest-restart |
| unmanaged | none | manual-install | - |
| npm-global | high/medium | delegate-command (`npm install -g`) | exit-after-apply |
| npm-global | low | manual-install | - |
| brew-cask | high/medium | delegate-command (`brew upgrade --cask`) | exit-after-apply |
| brew-cask | low | manual-install | - |
| (기타) | any | manual-install | - |

## 생성/수정 파일

| 파일 | 작업 |
|------|------|
| `src/planner/index.ts` | 생성 — `planUpdate`, 채널별 정책 함수, 에셋 선택 로직 |
| `src/planner/types.ts` | 생성 — `PlanKind`, `UpdatePlan`, `AssetInfo`, `PostAction` 타입 |
| `tests/planner/index.test.ts` | 생성 — 정책 매트릭스 전체 조합 테스트 |
| `tests/planner/asset-select.test.ts` | 생성 — 에셋 패턴 매칭 테스트 |

## 완료 기준

- [ ] `planUpdate`이 순수 함수로 동작한다 — I/O 없음, 사이드 이펙트 없음.
- [ ] `UpdateStatus`가 `up-to-date` 또는 `unknown`이면 `null`을 반환한다.
- [ ] 정책 매트릭스의 모든 (채널 x 신뢰도) 조합에 대해 올바른 `PlanKind`를 반환한다.
- [ ] native 채널에서 `allowReexec=true` + `confidence=high`이면 `reexec` PostAction을 반환한다.
- [ ] npm 채널에서 올바른 `npm install -g {pkg}@{version}` 명령어를 생성한다.
- [ ] brew 채널에서 올바른 `brew update && brew upgrade --cask {name}` 명령어를 생성한다.
- [ ] 에셋 선택이 현재 `process.platform`과 `process.arch`에 맞는 에셋을 정확히 찾는다.
- [ ] 매칭되는 에셋이 없으면 `manual-install`로 폴백한다.
- [ ] 사용자 지정 `assetPattern`이 자동 매칭보다 우선한다.
- [ ] Pre-release 버전, 동일 버전 등 엣지 케이스를 올바르게 처리한다.
- [ ] 모든 테스트가 통과한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 전체 플래너 테스트
npx vitest run tests/planner/

# 3. 정책 매트릭스 완전 커버리지 확인
npx vitest run tests/planner/index.test.ts

# 4. 에셋 선택 테스트
npx vitest run tests/planner/asset-select.test.ts

# 5. 엣지 케이스 테스트 — up-to-date, unknown, prerelease, 동일 버전
npx vitest run tests/planner/index.test.ts -t "edge cases"

# 6. 커버리지 확인 (planner 모듈 95% 이상 — 순수 함수이므로 높은 기준)
npx vitest run tests/planner/ --coverage

# 7. 매트릭스 조합 카운트 확인
npx vitest run tests/planner/index.test.ts --reporter=verbose 2>&1 | grep -c "PASS\|FAIL"
# 최소 20개 이상의 테스트 케이스 확인
```
