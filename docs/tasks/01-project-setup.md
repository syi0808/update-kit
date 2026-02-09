# Task 01: 프로젝트 초기 설정

## 목표

TypeScript 프로젝트의 빌드 및 테스트 인프라를 구성한다. ESM과 CJS 듀얼 출력을 지원하는 빌드 파이프라인, 테스트 프레임워크, 그리고 전체 소스 디렉터리 구조를 갖춘 프로젝트 기반을 마련한다.

## 선행 태스크

없음 (최초 태스크)

## 구현 상세

### 1. package.json

프로젝트 메타데이터와 듀얼 ESM/CJS exports를 설정한다.

```typescript
// package.json 주요 필드
{
  "name": "update-kit",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.mts",
        "default": "./dist/index.mjs"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.mts",
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "semver": "^7.6.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "tsup": "^8.0.0",
    "vitest": "^1.6.0"
  }
}
```

### 2. tsconfig.json

ES2022 타겟, 번들러 모듈 해석 방식, strict 모드를 활성화한다.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

### 3. tsup.config.ts

ESM과 CJS 듀얼 출력, 타입 선언 생성을 설정한다.

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node18',
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
});
```

### 4. vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
```

### 5. .gitignore

```
node_modules/
dist/
coverage/
*.tsbuildinfo
.DS_Store
```

### 6. 소스 디렉터리 구조

```
src/
  index.ts              # 공개 API re-export
  types.ts              # 공유 타입 정의
  errors.ts             # 에러 타입
  config.ts             # 설정 인터페이스
  detection/            # 설치 채널 감지
    index.ts
    receipt.ts
    brew.ts
    npm.ts
    heuristics.ts
  checker/              # 버전 확인
    index.ts
    cache.ts
    sources/
      index.ts
      github.ts
      npm-registry.ts
      jsr.ts
      brew-api.ts
      custom-manifest.ts
  planner/              # 업데이트 계획 수립
    index.ts
  applier/              # 업데이트 적용
    index.ts
    native.ts
    delegate.ts
  utils/                # 유틸리티
    platform.ts
    fs.ts
    http.ts
```

각 디렉터리의 `index.ts`에는 해당 모듈의 공개 API를 export하는 배럴 파일을 작성한다. 초기에는 빈 export(`export {}`)로 시작해도 무방하다.

## 생성/수정 파일

| 파일 | 작업 |
|------|------|
| `package.json` | 생성 |
| `tsconfig.json` | 생성 |
| `tsup.config.ts` | 생성 |
| `vitest.config.ts` | 생성 |
| `.gitignore` | 생성 |
| `src/index.ts` | 생성 (빈 배럴 파일) |
| `src/**/*.ts` | 생성 (디렉터리 구조에 따른 스켈레톤 파일) |

## 완료 기준

- [ ] `npm install`이 에러 없이 완료된다.
- [ ] `npm run build`가 성공하고, `dist/` 디렉터리에 `.mjs`, `.cjs`, `.d.mts`, `.d.cts` 파일이 생성된다.
- [ ] `npm test`가 실행된다 (테스트가 0개여도 에러 없이 종료).
- [ ] `tsc --noEmit`이 타입 에러 없이 통과한다.
- [ ] `package.json`의 exports 필드가 ESM/CJS 양쪽 진입점을 올바르게 가리킨다.

## 검증 방법

```bash
# 1. 의존성 설치
npm install

# 2. 빌드 실행 및 출력 확인
npm run build
ls dist/index.mjs dist/index.cjs dist/index.d.mts dist/index.d.cts

# 3. 테스트 실행 (0개 테스트여도 성공)
npm test

# 4. 타입 검사
npx tsc --noEmit

# 5. ESM import 테스트
node --input-type=module -e "import('file://' + process.cwd() + '/dist/index.mjs').then(() => console.log('ESM OK'))"

# 6. CJS require 테스트
node -e "require('./dist/index.cjs'); console.log('CJS OK')"
```
