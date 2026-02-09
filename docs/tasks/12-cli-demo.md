# Task 12: 데모 CLI

## 목표

update-kit의 기능을 테스트하고 시연할 수 있는 CLI 바이너리를 구현한다. 라이브러리 export에는 포함되지 않는 별도의 엔트리 포인트로, 각 모듈의 동작을 개별적으로 확인할 수 있는 서브커맨드와 JSON 출력 모드를 제공한다.

## 선행 태스크

- Task 11: 퍼블릭 API 통합

## 구현 상세

### 1. src/cli.ts - CLI 엔트리 포인트

외부 CLI 프레임워크 없이 `process.argv`를 직접 파싱하는 경량 구현을 사용한다.

```typescript
#!/usr/bin/env node

import { UpdateKit } from './index.js';
import type { UpdateKitConfig } from './config.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── 인자 파싱 ───

interface ParsedArgs {
  command: string;
  subcommand?: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // node, script 제외
  const command = args[0] ?? 'help';
  const subcommand = args[1] && !args[1].startsWith('--') ? args[1] : undefined;

  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  return { command, subcommand, flags };
}

// ─── 설정 로딩 ───

function loadConfig(configPath?: string): UpdateKitConfig {
  const path = configPath
    ? resolve(configPath)
    : resolve(process.cwd(), 'update-kit.config.json');

  if (!existsSync(path)) {
    console.error(`Config file not found: ${path}`);
    process.exit(1);
  }

  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as UpdateKitConfig;
}

// ─── 메인 ───

async function main(): Promise<void> {
  const { command, subcommand, flags } = parseArgs(process.argv);
  const isJson = flags['json'] === true;
  const config = loadConfig(flags['config'] as string | undefined);
  const kit = new UpdateKit(config);

  // 커맨드 라우팅
  switch (command) {
    case 'detect':
    case 'check':
    case 'plan':
    case 'apply':
    case 'cache':
    case 'help':
      // 각 핸들러 호출
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### 2. 서브커맨드 구현

각 서브커맨드는 독립적인 핸들러 함수로 구현한다.

#### `update-kit detect`

설치 채널 감지를 실행하고 결과를 출력한다.

```typescript
async function handleDetect(kit: UpdateKit, isJson: boolean): Promise<void> {
  const detection = await kit.detectInstall();

  if (isJson) {
    console.log(JSON.stringify(detection, null, 2));
  } else {
    console.log(`Channel:    ${detection.channel}`);
    console.log(`Confidence: ${detection.confidence}`);
    console.log('Evidence:');
    for (const e of detection.evidence) {
      console.log(`  - [${e.source}] ${e.detail}`);
    }
  }
}
```

#### `update-kit check [--blocking] [--background]`

업데이트를 확인한다. 기본 모드는 non-blocking이며, 플래그로 동작을 변경할 수 있다.

```typescript
async function handleCheck(
  kit: UpdateKit,
  flags: Record<string, string | boolean>,
  isJson: boolean,
): Promise<void> {
  if (flags['background']) {
    // 백그라운드 체크만 트리거
    kit.checkUpdate('non-blocking'); // await 하지 않음
    console.log('Background check started');
    return;
  }

  const mode = flags['blocking'] ? 'blocking' : 'non-blocking';
  const status = await kit.checkUpdate(mode);

  if (isJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    switch (status.kind) {
      case 'available':
        console.log(`Update available: ${status.current} → ${status.latest}`);
        if (status.releaseUrl) console.log(`Release: ${status.releaseUrl}`);
        break;
      case 'up-to-date':
        console.log(`Up to date: ${status.current}`);
        break;
      case 'unknown':
        console.log(`Unable to check: ${status.reason}`);
        break;
    }
  }
}
```

#### `update-kit plan`

감지, 확인, 계획 수립을 순서대로 실행하고 업데이트 계획을 출력한다.

```typescript
async function handlePlan(kit: UpdateKit, isJson: boolean): Promise<void> {
  const detection = await kit.detectInstall();
  const status = await kit.checkUpdate('blocking');

  if (status.kind !== 'available') {
    console.log(isJson
      ? JSON.stringify({ message: 'No update available' })
      : 'No update available');
    return;
  }

  const plan = kit.planUpdate(status, detection);

  if (isJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`Plan: ${plan.kind.type}`);
    console.log(`From: ${plan.fromVersion} → To: ${plan.toVersion}`);
    console.log(`Post action: ${plan.postAction}`);
    if (plan.kind.type === 'delegate-command') {
      console.log(`Command: ${plan.kind.command.join(' ')}`);
    }
  }
}
```

#### `update-kit apply [--execute]`

전체 파이프라인을 실행한다. `--execute` 플래그 없이는 위임 명령어를 출력만 한다.

```typescript
async function handleApply(
  kit: UpdateKit,
  flags: Record<string, string | boolean>,
  isJson: boolean,
): Promise<void> {
  const result = await kit.autoUpdate({
    delegateMode: flags['execute'] ? 'execute' : 'print-only',
  });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    switch (result.kind) {
      case 'success':
        console.log(`Updated: ${result.fromVersion} → ${result.toVersion}`);
        break;
      case 'needs-restart':
        console.log(result.message);
        break;
      case 'failed':
        console.error(`Update failed: ${result.error.message}`);
        process.exit(1);
    }
  }
}
```

#### `update-kit cache show` / `update-kit cache clear`

캐시 관련 서브커맨드를 처리한다.

```typescript
async function handleCache(
  subcommand: string | undefined,
  config: UpdateKitConfig,
  isJson: boolean,
): Promise<void> {
  switch (subcommand) {
    case 'show': {
      // 캐시 파일을 읽어서 내용 출력
      const cachePath = resolveCachePath(config);
      if (!existsSync(cachePath)) {
        console.log(isJson ? JSON.stringify({ cache: null }) : 'No cache found');
        return;
      }
      const data = readFileSync(cachePath, 'utf-8');
      console.log(isJson ? data : `Cache contents:\n${data}`);
      break;
    }
    case 'clear': {
      // 캐시 파일 삭제
      const cachePath = resolveCachePath(config);
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
      }
      console.log(isJson ? JSON.stringify({ cleared: true }) : 'Cache cleared');
      break;
    }
    default:
      console.error('Usage: update-kit cache <show|clear>');
      process.exit(1);
  }
}
```

### 3. 도움말 출력

```typescript
function printUsage(): void {
  console.log(`
update-kit - CLI app update management toolkit

Usage: update-kit <command> [options]

Commands:
  detect              Detect install channel
  check [--blocking]  Check for updates
  check --background  Trigger background check only
  plan                Detect + check + plan update
  apply [--execute]   Run full update pipeline
  cache show          Show current cache contents
  cache clear         Clear cache

Options:
  --config <path>     Path to config file (default: ./update-kit.config.json)
  --json              Output as JSON
  --help              Show this help message
  `.trim());
}
```

### 4. package.json bin 필드

`package.json`에 `bin` 필드를 추가하고, `tsup.config.ts`의 엔트리에 CLI를 추가한다.

```json
{
  "bin": {
    "update-kit": "./dist/cli.js"
  }
}
```

```typescript
// tsup.config.ts 수정
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: ['src/index.ts'] }, // CLI에는 타입 선언 불필요
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

### 5. 설정 파일 예시

테스트 및 데모용 설정 파일 예시:

```json
// update-kit.config.json (예시)
{
  "appName": "my-cli",
  "currentVersion": "1.0.0",
  "sources": [
    {
      "type": "github",
      "owner": "my-org",
      "repo": "my-cli"
    }
  ],
  "checkInterval": 72000000,
  "delegateMode": "print-only"
}
```

## 생성/수정 파일

| 파일 | 작업 | 설명 |
|------|------|------|
| `src/cli.ts` | 생성 | CLI 엔트리 포인트 및 서브커맨드 핸들러 |
| `package.json` | 수정 | `bin` 필드 추가 |
| `tsup.config.ts` | 수정 | CLI 엔트리 포인트 추가 |
| `examples/update-kit.config.json` | 생성 | 예시 설정 파일 |
| `src/__tests__/cli.e2e.test.ts` | 생성 | E2E 테스트 |

## 완료 기준

- [ ] `src/cli.ts`가 별도 엔트리 포인트로 빌드된다 (라이브러리 export와 분리).
- [ ] 6개 서브커맨드(`detect`, `check`, `plan`, `apply`, `cache show`, `cache clear`)가 구현되어 있다.
- [ ] `--json` 플래그로 JSON 출력을 지원한다.
- [ ] `--config` 플래그로 사용자 지정 설정 파일 경로를 지원한다.
- [ ] 기본적으로 CWD의 `update-kit.config.json`을 읽는다.
- [ ] `package.json`의 `bin` 필드가 올바르게 설정되어 있다.
- [ ] `npm run build` 후 `./dist/cli.mjs`(또는 `.cjs`)가 생성된다.
- [ ] 인자 없이 실행 시 도움말이 출력된다.

## 검증 방법

```bash
# 1. 빌드
npm run build

# 2. 도움말 출력 확인
node dist/cli.mjs --help

# 3. 예시 설정 파일로 detect 실행
node dist/cli.mjs detect --config examples/update-kit.config.json

# 4. JSON 출력 확인
node dist/cli.mjs detect --config examples/update-kit.config.json --json

# 5. 캐시 서브커맨드
node dist/cli.mjs cache show --config examples/update-kit.config.json
node dist/cli.mjs cache clear --config examples/update-kit.config.json
```

아래 E2E 테스트를 작성하여 CLI가 올바르게 동작하는지 검증한다.

```typescript
// src/__tests__/cli.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CLI E2E', () => {
  let tmpDir: string;
  let configPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'update-kit-cli-'));
    configPath = join(tmpDir, 'update-kit.config.json');
    writeFileSync(configPath, JSON.stringify({
      appName: 'test-app',
      currentVersion: '1.0.0',
      sources: [],
    }));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCli(...args: string[]): string {
    return execFileSync(
      'node',
      ['dist/cli.mjs', ...args, '--config', configPath],
      { encoding: 'utf-8', timeout: 10_000 },
    );
  }

  it('인자 없이 실행 시 도움말을 출력한다', () => {
    const output = execFileSync('node', ['dist/cli.mjs'], {
      encoding: 'utf-8',
    });
    expect(output).toContain('Usage:');
    expect(output).toContain('Commands:');
  });

  it('detect 커맨드가 JSON 출력을 지원한다', () => {
    const output = runCli('detect', '--json');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('channel');
    expect(parsed).toHaveProperty('confidence');
  });

  it('check 커맨드가 동작한다', () => {
    const output = runCli('check');
    // sources가 비어있으므로 unknown 또는 에러 메시지 예상
    expect(output).toBeTruthy();
  });

  it('cache show 커맨드가 동작한다', () => {
    const output = runCli('cache', 'show');
    expect(output).toBeTruthy();
  });

  it('cache clear 커맨드가 동작한다', () => {
    const output = runCli('cache', 'clear');
    expect(output.toLowerCase()).toContain('clear');
  });
});
```
