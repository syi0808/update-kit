# Task 04: 버전 소스 플러그인 시스템

## 목표

플러거블(pluggable) `VersionSource` 인터페이스를 정의하고, 5개의 빌트인 버전 소스를 구현한다. 각 소스는 외부 레지스트리(GitHub, npm, JSR, Homebrew, 커스텀 URL)로부터 최신 버전 정보를 가져온다. ETag 기반 조건부 요청을 지원하여 불필요한 데이터 전송을 최소화한다.

## 선행 태스크

- Task 02: 핵심 타입 정의

## 구현 상세

### 1. src/checker/sources/index.ts - 인터페이스 및 팩토리

버전 소스 플러그인의 공통 인터페이스와 팩토리 함수를 정의한다.

```typescript
import type { VersionSourceConfig } from '../../config.js';

/** 버전 정보 */
export interface VersionInfo {
  /** 최신 버전 (semver 문자열) */
  version: string;
  /** 릴리스 페이지 URL */
  releaseUrl?: string;
  /** 릴리스 노트 (마크다운 등) */
  releaseNotes?: string;
  /** 다운로드 가능한 에셋 목록 */
  assets?: AssetInfo[];
  /** 릴리스 게시 시각 (ISO 8601) */
  publishedAt?: string;
}

/** 에셋(다운로드 파일) 정보 */
export interface AssetInfo {
  /** 파일명 */
  name: string;
  /** 다운로드 URL */
  url: string;
  /** 파일 크기 (바이트) */
  size?: number;
  /** 체크섬 파일 URL */
  checksumUrl?: string;
}

/**
 * 버전 소스 플러그인 인터페이스.
 * 각 소스는 외부 레지스트리로부터 최신 버전 정보를 가져오는 역할을 한다.
 */
export interface VersionSource {
  /** 소스 식별 이름 (예: "github", "npm") */
  name: string;

  /**
   * 최신 버전 정보를 가져온다.
   *
   * @param options.etag - 이전 응답의 ETag. 서버가 304를 반환하면 'not-modified'를 반환.
   * @param options.signal - 요청 취소용 AbortSignal.
   * @returns 버전 정보, not-modified 응답, 또는 에러.
   */
  fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult>;
}

/** fetchLatest 반환 결과 */
export type VersionSourceResult =
  | { kind: 'found'; info: VersionInfo; etag?: string }
  | { kind: 'not-modified'; etag: string }
  | { kind: 'error'; reason: string };

/**
 * 설정 객체로부터 적절한 VersionSource 인스턴스를 생성하는 팩토리 함수.
 *
 * @param config - 버전 소스 설정
 * @returns VersionSource 구현체
 * @throws UpdateKitError - 알 수 없는 소스 타입일 경우
 */
export function createVersionSource(config: VersionSourceConfig): VersionSource {
  switch (config.type) {
    case 'github':
      // 동적 import를 피하고 직접 import하여 트리 쉐이킹 지원
      return new GitHubReleasesSource(config as GitHubSourceConfig);
    case 'npm':
      return new NpmRegistrySource(config as NpmSourceConfig);
    case 'jsr':
      return new JsrSource(config as JsrSourceConfig);
    case 'brew':
      return new BrewSource(config as BrewSourceConfig);
    case 'custom':
      return new CustomManifestSource(config as CustomManifestSourceConfig);
    default:
      throw new Error(`알 수 없는 버전 소스 타입: ${config.type}`);
  }
}

// 각 소스의 설정 타입 및 클래스는 개별 파일에서 import
import { GitHubReleasesSource, type GitHubSourceConfig } from './github.js';
import { NpmRegistrySource, type NpmSourceConfig } from './npm-registry.js';
import { JsrSource, type JsrSourceConfig } from './jsr.js';
import { BrewSource, type BrewSourceConfig } from './brew-api.js';
import {
  CustomManifestSource,
  type CustomManifestSourceConfig,
} from './custom-manifest.js';

export type {
  GitHubSourceConfig,
  NpmSourceConfig,
  JsrSourceConfig,
  BrewSourceConfig,
  CustomManifestSourceConfig,
};
```

### 2. src/checker/sources/github.ts - GitHub Releases 소스

GitHub API를 사용하여 최신 릴리스 정보를 가져온다.

```typescript
import type { VersionSource, VersionSourceResult, VersionInfo, AssetInfo } from './index.js';

export interface GitHubSourceConfig {
  type: 'github';
  /** 저장소 소유자 */
  owner: string;
  /** 저장소 이름 */
  repo: string;
  /** GitHub API 토큰 (선택, rate limit 회피용) */
  token?: string;
  /** API 기본 URL (GitHub Enterprise 등) */
  apiBaseUrl?: string;
}

export class GitHubReleasesSource implements VersionSource {
  readonly name = 'github';
  private readonly config: GitHubSourceConfig;

  constructor(config: GitHubSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const baseUrl = this.config.apiBaseUrl ?? 'https://api.github.com';
    const url = `${baseUrl}/repos/${this.config.owner}/${this.config.repo}/releases/latest`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'update-kit',
    };

    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    if (options?.etag) {
      headers['If-None-Match'] = options.etag;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: options?.signal,
      });

      if (response.status === 304 && options?.etag) {
        return { kind: 'not-modified', etag: options.etag };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `GitHub API 응답 실패: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      // tag_name에서 'v' 접두어 제거
      const version = data.tag_name?.replace(/^v/, '') ?? data.tag_name;

      const assets: AssetInfo[] = (data.assets ?? []).map((asset: any) => ({
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size,
      }));

      const info: VersionInfo = {
        version,
        releaseUrl: data.html_url,
        releaseNotes: data.body,
        assets,
        publishedAt: data.published_at,
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `GitHub API 요청 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
```

### 3. src/checker/sources/npm-registry.ts - npm 레지스트리 소스

npm 레지스트리에서 패키지의 최신 버전 정보를 가져온다.

```typescript
import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';

export interface NpmSourceConfig {
  type: 'npm';
  /** npm 패키지 이름 */
  packageName: string;
  /** 레지스트리 URL (기본값: https://registry.npmjs.org) */
  registryUrl?: string;
}

export class NpmRegistrySource implements VersionSource {
  readonly name = 'npm';
  private readonly config: NpmSourceConfig;

  constructor(config: NpmSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const registry = this.config.registryUrl ?? 'https://registry.npmjs.org';
    const url = `${registry}/${this.config.packageName}/latest`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (options?.etag) {
      headers['If-None-Match'] = options.etag;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: options?.signal,
      });

      if (response.status === 304 && options?.etag) {
        return { kind: 'not-modified', etag: options.etag };
      }

      if (response.status === 404) {
        return {
          kind: 'error',
          reason: `npm 패키지를 찾을 수 없음: ${this.config.packageName}`,
        };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `npm 레지스트리 응답 실패: ${response.status}`,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      const info: VersionInfo = {
        version: data.version,
        releaseUrl: `https://www.npmjs.com/package/${this.config.packageName}`,
        publishedAt: data.time?.[data.version],
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `npm 레지스트리 요청 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
```

### 4. src/checker/sources/jsr.ts - JSR 소스

JSR(JavaScript Registry)에서 패키지의 메타데이터를 가져온다.

```typescript
import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';

export interface JsrSourceConfig {
  type: 'jsr';
  /** 스코프 (@ 제외, 예: "std") */
  scope: string;
  /** 패키지 이름 */
  name: string;
}

export class JsrSource implements VersionSource {
  readonly name = 'jsr';
  private readonly config: JsrSourceConfig;

  constructor(config: JsrSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const url = `https://jsr.io/@${this.config.scope}/${this.config.name}/meta.json`;

    const headers: Record<string, string> = {};

    if (options?.etag) {
      headers['If-None-Match'] = options.etag;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: options?.signal,
      });

      if (response.status === 304 && options?.etag) {
        return { kind: 'not-modified', etag: options.etag };
      }

      if (response.status === 404) {
        return {
          kind: 'error',
          reason: `JSR 패키지를 찾을 수 없음: @${this.config.scope}/${this.config.name}`,
        };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `JSR 응답 실패: ${response.status}`,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      // meta.json에서 latest 버전 추출
      const latest = data.latest ?? Object.keys(data.versions ?? {}).pop();

      if (!latest) {
        return {
          kind: 'error',
          reason: 'JSR 메타데이터에서 최신 버전을 찾을 수 없음',
        };
      }

      const info: VersionInfo = {
        version: latest,
        releaseUrl: `https://jsr.io/@${this.config.scope}/${this.config.name}`,
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `JSR 요청 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
```

### 5. src/checker/sources/brew-api.ts - Homebrew Formulae API 소스

Homebrew Formulae API에서 cask의 최신 버전 정보를 가져온다.

```typescript
import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';

export interface BrewSourceConfig {
  type: 'brew';
  /** Homebrew cask 이름 */
  caskName: string;
}

export class BrewSource implements VersionSource {
  readonly name = 'brew';
  private readonly config: BrewSourceConfig;

  constructor(config: BrewSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const url = `https://formulae.brew.sh/api/cask/${this.config.caskName}.json`;

    const headers: Record<string, string> = {};

    if (options?.etag) {
      headers['If-None-Match'] = options.etag;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: options?.signal,
      });

      if (response.status === 304 && options?.etag) {
        return { kind: 'not-modified', etag: options.etag };
      }

      if (response.status === 404) {
        return {
          kind: 'error',
          reason: `Homebrew cask를 찾을 수 없음: ${this.config.caskName}`,
        };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `Homebrew API 응답 실패: ${response.status}`,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      const info: VersionInfo = {
        version: data.version,
        releaseUrl: data.homepage,
        publishedAt: data.installed?.[0]?.time,
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `Homebrew API 요청 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
```

### 6. src/checker/sources/custom-manifest.ts - 커스텀 매니페스트 소스

사용자가 지정한 URL에서 JSON 매니페스트를 가져와 버전 정보를 추출한다.

```typescript
import type { VersionSource, VersionSourceResult, VersionInfo } from './index.js';

export interface CustomManifestSourceConfig {
  type: 'custom';
  /** 매니페스트 JSON URL */
  url: string;
  /** 버전 필드 이름 (기본값: "version"). 점(.)으로 중첩 경로 지원 (예: "data.latest.version") */
  versionField?: string;
}

export class CustomManifestSource implements VersionSource {
  readonly name = 'custom';
  private readonly config: CustomManifestSourceConfig;

  constructor(config: CustomManifestSourceConfig) {
    this.config = config;
  }

  async fetchLatest(options?: {
    etag?: string;
    signal?: AbortSignal;
  }): Promise<VersionSourceResult> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (options?.etag) {
      headers['If-None-Match'] = options.etag;
    }

    try {
      const response = await fetch(this.config.url, {
        headers,
        signal: options?.signal,
      });

      if (response.status === 304 && options?.etag) {
        return { kind: 'not-modified', etag: options.etag };
      }

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `커스텀 매니페스트 응답 실패: ${response.status}`,
        };
      }

      const data = await response.json();
      const etag = response.headers.get('etag') ?? undefined;

      // 중첩 경로 지원 (예: "data.latest.version")
      const fieldPath = this.config.versionField ?? 'version';
      const version = getNestedValue(data, fieldPath);

      if (typeof version !== 'string') {
        return {
          kind: 'error',
          reason: `매니페스트에서 버전 필드를 찾을 수 없음: ${fieldPath}`,
        };
      }

      const info: VersionInfo = {
        version,
        releaseUrl: data.releaseUrl ?? data.url,
        releaseNotes: data.releaseNotes ?? data.changelog,
        publishedAt: data.publishedAt ?? data.date,
      };

      return { kind: 'found', info, etag };
    } catch (error) {
      return {
        kind: 'error',
        reason: `커스텀 매니페스트 요청 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * 점(.)으로 구분된 경로를 사용하여 객체의 중첩된 값을 가져온다.
 * 예: getNestedValue({ a: { b: "1.0" } }, "a.b") → "1.0"
 */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current != null && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
```

### 7. 팩토리 함수 사용 예시

```typescript
import { createVersionSource } from './checker/sources/index.js';

// GitHub 소스 생성
const githubSource = createVersionSource({
  type: 'github',
  owner: 'example',
  repo: 'my-cli',
});

// 최신 버전 확인
const result = await githubSource.fetchLatest();
if (result.kind === 'found') {
  console.log(`최신 버전: ${result.info.version}`);
}

// ETag를 이용한 조건부 요청
const cached = await githubSource.fetchLatest({ etag: result.etag });
if (cached.kind === 'not-modified') {
  console.log('변경 없음');
}
```

## 생성/수정 파일

| 파일 | 작업 | 설명 |
|------|------|------|
| `src/checker/sources/index.ts` | 생성 | `VersionSource` 인터페이스, 관련 타입, `createVersionSource` 팩토리 |
| `src/checker/sources/github.ts` | 생성 | GitHub Releases API 소스 |
| `src/checker/sources/npm-registry.ts` | 생성 | npm 레지스트리 소스 |
| `src/checker/sources/jsr.ts` | 생성 | JSR 메타데이터 소스 |
| `src/checker/sources/brew-api.ts` | 생성 | Homebrew Formulae API 소스 |
| `src/checker/sources/custom-manifest.ts` | 생성 | 커스텀 매니페스트 소스 |
| `src/index.ts` | 수정 | `createVersionSource` 및 관련 타입 re-export 추가 |

## 완료 기준

- [ ] `VersionSource` 인터페이스가 `fetchLatest` 메서드를 가지며, `VersionSourceResult`를 반환한다.
- [ ] `createVersionSource` 팩토리가 5개 소스 타입 모두를 올바르게 인스턴스화한다.
- [ ] 각 소스의 `fetchLatest`가 성공 시 `{ kind: 'found', info: VersionInfo }`를 반환한다.
- [ ] ETag가 전달되고 서버가 304를 반환하면 `{ kind: 'not-modified' }`를 반환한다.
- [ ] 네트워크 오류, 404, rate limit 등 실패 시 `{ kind: 'error', reason: string }`을 반환한다 (예외를 throw하지 않음).
- [ ] `AbortSignal`을 통한 요청 취소가 가능하다.
- [ ] `CustomManifestSource`가 중첩 경로(예: `"data.version"`)를 올바르게 처리한다.
- [ ] GitHub 소스가 tag_name에서 `v` 접두어를 올바르게 제거한다.
- [ ] 모든 소스에 대한 단위 테스트가 통과한다.

## 검증 방법

```bash
# 1. 타입 검사
npx tsc --noEmit

# 2. 빌드
npm run build

# 3. 단위 테스트 실행
npm test -- src/checker/sources/
```

아래 테스트를 작성하여 각 소스를 검증한다. `fetch`를 모킹하여 실제 네트워크 요청 없이 테스트한다.

```typescript
// src/checker/sources/__tests__/sources.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVersionSource } from '../index.js';

// global fetch 모킹
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  vi.resetAllMocks();
});

describe('GitHubReleasesSource', () => {
  const source = createVersionSource({
    type: 'github',
    owner: 'example',
    repo: 'my-cli',
  });

  it('최신 릴리스 버전을 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: '"abc123"' }),
      json: async () => ({
        tag_name: 'v2.1.0',
        html_url: 'https://github.com/example/my-cli/releases/tag/v2.1.0',
        body: '## 변경 사항\n- 버그 수정',
        published_at: '2024-01-15T00:00:00Z',
        assets: [
          {
            name: 'my-cli-2.1.0-linux-x64.tar.gz',
            browser_download_url: 'https://github.com/example/my-cli/releases/download/v2.1.0/my-cli-2.1.0-linux-x64.tar.gz',
            size: 10485760,
          },
        ],
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe('found');
    if (result.kind === 'found') {
      expect(result.info.version).toBe('2.1.0'); // v 접두어 제거됨
      expect(result.info.assets).toHaveLength(1);
      expect(result.etag).toBe('"abc123"');
    }
  });

  it('ETag가 일치하면 not-modified를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 304,
      headers: new Headers(),
    });

    const result = await source.fetchLatest({ etag: '"abc123"' });
    expect(result.kind).toBe('not-modified');
  });

  it('rate limit 초과 시 error를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe('error');
  });

  it('네트워크 오류 시 error를 반환한다', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await source.fetchLatest();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('Failed to fetch');
    }
  });
});

describe('NpmRegistrySource', () => {
  const source = createVersionSource({
    type: 'npm',
    packageName: 'my-cli',
  });

  it('npm 레지스트리에서 최신 버전을 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        version: '3.0.0',
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe('found');
    if (result.kind === 'found') {
      expect(result.info.version).toBe('3.0.0');
    }
  });

  it('존재하지 않는 패키지에 대해 error를 반환한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe('error');
  });
});

describe('CustomManifestSource', () => {
  it('중첩 경로에서 버전을 추출한다', async () => {
    const source = createVersionSource({
      type: 'custom',
      url: 'https://example.com/manifest.json',
      versionField: 'data.latest.version',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        data: {
          latest: {
            version: '1.5.0',
          },
        },
      }),
    });

    const result = await source.fetchLatest();
    expect(result.kind).toBe('found');
    if (result.kind === 'found') {
      expect(result.info.version).toBe('1.5.0');
    }
  });
});

describe('createVersionSource', () => {
  it('알 수 없는 타입에 대해 에러를 throw한다', () => {
    expect(() =>
      createVersionSource({ type: 'unknown' as any }),
    ).toThrow('알 수 없는 버전 소스 타입');
  });
});
```
