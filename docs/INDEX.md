# update-kit

CLI 앱의 설치 채널을 감지하고, 안전한 방식으로 업데이트를 안내/실행하는 TypeScript 프레임워크.

## 기술 스택

| 항목 | 선택 |
|------|------|
| 언어 | TypeScript (Node.js 18+) |
| 빌드 | tsup (ESM + CJS 듀얼) |
| 테스트 | vitest |
| HTTP | Node.js native fetch |
| 체크섬 | Node.js crypto |
| 프로세스 | child_process |

## 핵심 설계

- **채널 기반 정책**: 설치 방식(native/npm/brew/unmanaged)에 따라 업데이트 전략 결정
- **버전 소스 플러그인**: GitHub Releases, npm, JSR, brew, custom manifest 등 설정 가능
- **Non-blocking 기본값**: 현재 실행은 캐시로 판단, 백그라운드에서 최신 버전 갱신
- **안전 정책**: in-place 교체는 native/unmanaged에서만, 패키지 매니저는 위임

## 태스크 진행 상황

| # | 태스크 | 상태 | 문서 |
|---|--------|------|------|
| 01 | 프로젝트 초기 설정 | [X] | [01-project-setup.md](tasks/01-project-setup.md) |
| 02 | 핵심 타입 정의 | [X] | [02-core-types.md](tasks/02-core-types.md) |
| 03 | 설치 채널 감지 | [X] | [03-channel-detection.md](tasks/03-channel-detection.md) |
| 04 | 버전 소스 플러그인 시스템 | [X] | [04-version-source-plugin.md](tasks/04-version-source-plugin.md) |
| 05 | 버전 체커 | [X] | [05-version-checker.md](tasks/05-version-checker.md) |
| 06 | 캐시 시스템 | [ ] | [06-cache-system.md](tasks/06-cache-system.md) |
| 07 | 업데이트 플래너 | [ ] | [07-update-planner.md](tasks/07-update-planner.md) |
| 08 | 업데이트 적용 - Native | [ ] | [08-applier-native.md](tasks/08-applier-native.md) |
| 09 | 업데이트 적용 - Delegate | [ ] | [09-applier-delegate.md](tasks/09-applier-delegate.md) |
| 10 | UX 레이어 | [ ] | [10-ux-layer.md](tasks/10-ux-layer.md) |
| 11 | 퍼블릭 API 통합 | [ ] | [11-public-api.md](tasks/11-public-api.md) |
| 12 | 데모 CLI | [ ] | [12-cli-demo.md](tasks/12-cli-demo.md) |
| 13 | 하드닝 + 크로스플랫폼 | [ ] | [13-hardening.md](tasks/13-hardening.md) |

## 의존 관계

```
01 Setup
 └─ 02 Types
     ├─ 03 Detection
     └─ 04 Sources
         └─ 05 Checker
             └─ 06 Cache
                 └─ 07 Planner
                     ├─ 08 Native Applier
                     ├─ 09 Delegate Applier
                     └─ 10 UX
                         └─ 11 Public API
                             └─ 12 CLI
                                 └─ 13 Hardening
```

## 프로젝트 구조

```
src/
  index.ts                  # 퍼블릭 API re-export
  config.ts                 # UpdateKitConfig
  types.ts                  # 공유 타입
  errors.ts                 # UpdateKitError
  detection/                # 설치 채널 감지
    index.ts, receipt.ts, heuristics.ts, brew.ts, npm.ts
  checker/                  # 버전 체크
    index.ts, cache.ts, background.ts
    sources/                # 버전 소스 플러그인
      index.ts, github.ts, npm-registry.ts, jsr.ts, brew-api.ts, custom-manifest.ts
  planner/                  # 업데이트 계획
    index.ts
  applier/                  # 업데이트 적용
    index.ts, native.ts, delegate.ts, verify.ts
  ux/                       # UX 레이어
    index.ts, templates.ts
  platform/                 # 플랫폼 추상화
    index.ts, paths.ts, replace.ts
```
