# Version List & Downgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add version listing with pagination and version switching (upgrade/downgrade) to update-kit's library API.

**Architecture:** Extend the existing `VersionSource` interface with an optional `fetchVersions()` method. Each source (GitHub, npm, JSR) implements it using its native API. The planner gains a `targetVersion` option so it can plan downgrades. `UpdateKit` class gets `listVersions()` and `switchVersion()` orchestration methods.

**Tech Stack:** TypeScript, vitest, semver, Node.js native fetch

---

### Task 1: Add types for version listing

**Files:**
- Modify: `src/checker/sources/index.ts:41-62`

**Step 1: Write the failing test**

Create test file `src/checker/sources/__tests__/fetch-versions.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVersionSource } from '../index.js';
import type { FetchVersionsOptions, VersionListResult } from '../index.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  vi.resetAllMocks();
});

describe('FetchVersionsOptions type', () => {
  it('accepts limit, cursor, and signal options', () => {
    const options: FetchVersionsOptions = {
      limit: 10,
      cursor: 'page:2',
      signal: new AbortController().signal,
    };
    expect(options.limit).toBe(10);
    expect(options.cursor).toBe('page:2');
  });
});

describe('VersionListResult type', () => {
  it('success variant has versions array and optional nextCursor/totalCount', () => {
    const result: VersionListResult = {
      kind: 'success',
      versions: [{ version: '1.0.0' }],
      nextCursor: 'page:2',
      totalCount: 50,
    };
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions).toHaveLength(1);
      expect(result.nextCursor).toBe('page:2');
    }
  });

  it('error variant has reason string', () => {
    const result: VersionListResult = {
      kind: 'error',
      reason: 'not supported',
    };
    expect(result.kind).toBe('error');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: FAIL — `FetchVersionsOptions` and `VersionListResult` are not exported from `../index.js`

**Step 3: Implement the types**

In `src/checker/sources/index.ts`, add after the `VersionSourceResult` type (line 62):

```typescript
/** Options for fetching a list of versions */
export interface FetchVersionsOptions {
  /** Maximum number of versions to return. Default: 20 */
  limit?: number;
  /** Opaque pagination cursor from a previous result's nextCursor */
  cursor?: string;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
}

/** Result of fetching a version list */
export type VersionListResult =
  | { kind: 'success'; versions: VersionInfo[]; nextCursor?: string; totalCount?: number }
  | { kind: 'error'; reason: string };
```

Add optional `fetchVersions` to the `VersionSource` interface (after `fetchLatest`):

```typescript
  /**
   * Fetch a list of available versions with pagination.
   * Optional — sources that cannot list versions simply omit this method.
   */
  fetchVersions?(options?: FetchVersionsOptions): Promise<VersionListResult>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: PASS

**Step 5: Run existing tests to check for regressions**

Run: `pnpm test -- src/checker/sources/__tests__/sources.test.ts`
Expected: PASS (no changes to existing behavior)

**Step 6: Commit**

```bash
git add src/checker/sources/index.ts src/checker/sources/__tests__/fetch-versions.test.ts
git commit -m "feat: add FetchVersionsOptions and VersionListResult types to VersionSource"
```

---

### Task 2: Implement fetchVersions for GitHub source

**Files:**
- Modify: `src/checker/sources/github.ts`
- Modify: `src/checker/sources/__tests__/fetch-versions.test.ts`

**Step 1: Write the failing tests**

Append to `src/checker/sources/__tests__/fetch-versions.test.ts`:

```typescript
describe('GitHubReleasesSource.fetchVersions', () => {
  const source = createVersionSource({
    type: 'github',
    owner: 'example',
    repo: 'my-cli',
  });

  it('returns a list of versions sorted descending', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ([
        {
          tag_name: 'v3.0.0',
          html_url: 'https://github.com/example/my-cli/releases/tag/v3.0.0',
          body: 'Release 3',
          published_at: '2024-03-01T00:00:00Z',
          assets: [],
        },
        {
          tag_name: 'v2.0.0',
          html_url: 'https://github.com/example/my-cli/releases/tag/v2.0.0',
          body: 'Release 2',
          published_at: '2024-02-01T00:00:00Z',
          assets: [{ name: 'app.tar.gz', browser_download_url: 'https://example.com/app.tar.gz', size: 1024 }],
        },
      ]),
    });

    const result = await source.fetchVersions!({ limit: 10 });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions).toHaveLength(2);
      expect(result.versions[0].version).toBe('3.0.0');
      expect(result.versions[1].version).toBe('2.0.0');
      expect(result.versions[1].assets).toHaveLength(1);
    }
  });

  it('uses per_page and page query parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ([]),
    });

    await source.fetchVersions!({ limit: 5, cursor: 'page:3' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('per_page=5'),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('page=3'),
      expect.any(Object),
    );
  });

  it('defaults to page 1 and limit 20 when no options', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ([]),
    });

    await source.fetchVersions!();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('per_page=20'),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('page=1'),
      expect.any(Object),
    );
  });

  it('returns nextCursor when results equal limit', async () => {
    const releases = Array.from({ length: 5 }, (_, i) => ({
      tag_name: `v${5 - i}.0.0`,
      html_url: `https://github.com/example/my-cli/releases/tag/v${5 - i}.0.0`,
      assets: [],
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => releases,
    });

    const result = await source.fetchVersions!({ limit: 5 });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.nextCursor).toBe('page:2');
    }
  });

  it('returns no nextCursor when results are less than limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ([
        { tag_name: 'v1.0.0', assets: [] },
      ]),
    });

    const result = await source.fetchVersions!({ limit: 20 });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.nextCursor).toBeUndefined();
    }
  });

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers(),
    });

    const result = await source.fetchVersions!();
    expect(result.kind).toBe('error');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await source.fetchVersions!();
    expect(result.kind).toBe('error');
  });

  it('sends Authorization header when token is provided', async () => {
    const authedSource = createVersionSource({
      type: 'github',
      owner: 'example',
      repo: 'my-cli',
      token: 'ghp_test123',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ([]),
    });

    await authedSource.fetchVersions!();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test123',
        }),
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: FAIL — `source.fetchVersions` is `undefined`

**Step 3: Implement fetchVersions on GitHubReleasesSource**

In `src/checker/sources/github.ts`, add the import and method to the class:

```typescript
import type { VersionSource, VersionSourceResult, VersionInfo, AssetInfo, FetchVersionsOptions, VersionListResult } from './index.js';

// ... inside the class, after fetchLatest:

  async fetchVersions(options?: FetchVersionsOptions): Promise<VersionListResult> {
    const limit = options?.limit ?? 20;
    const cursorStr = options?.cursor;
    const page = cursorStr ? parseInt(cursorStr.replace('page:', ''), 10) : 1;

    const baseUrl = this.config.apiBaseUrl ?? 'https://api.github.com';
    const url = `${baseUrl}/repos/${this.config.owner}/${this.config.repo}/releases?per_page=${limit}&page=${page}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'update-kit',
    };

    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: options?.signal,
      });

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `GitHub API responded with failure: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json() as any[];

      const versions: VersionInfo[] = data.map((release: any) => ({
        version: release.tag_name?.replace(/^v/, '') ?? release.tag_name,
        releaseUrl: release.html_url,
        releaseNotes: release.body,
        publishedAt: release.published_at,
        assets: (release.assets ?? []).map((asset: any) => ({
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size,
        })),
      }));

      const nextCursor = data.length >= limit ? `page:${page + 1}` : undefined;

      return { kind: 'success', versions, nextCursor };
    } catch (error) {
      return {
        kind: 'error',
        reason: `GitHub API request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/checker/sources/github.ts src/checker/sources/__tests__/fetch-versions.test.ts
git commit -m "feat: implement fetchVersions for GitHub releases source"
```

---

### Task 3: Implement fetchVersions for npm source

**Files:**
- Modify: `src/checker/sources/npm-registry.ts`
- Modify: `src/checker/sources/__tests__/fetch-versions.test.ts`

**Step 1: Write the failing tests**

Append to `src/checker/sources/__tests__/fetch-versions.test.ts`:

```typescript
describe('NpmRegistrySource.fetchVersions', () => {
  const source = createVersionSource({
    type: 'npm',
    packageName: 'my-cli',
  });

  const fullPackument = {
    versions: {
      '1.0.0': { version: '1.0.0' },
      '1.1.0': { version: '1.1.0' },
      '2.0.0': { version: '2.0.0' },
      '2.1.0': { version: '2.1.0' },
      '3.0.0': { version: '3.0.0' },
    },
    time: {
      '1.0.0': '2024-01-01T00:00:00Z',
      '1.1.0': '2024-02-01T00:00:00Z',
      '2.0.0': '2024-03-01T00:00:00Z',
      '2.1.0': '2024-04-01T00:00:00Z',
      '3.0.0': '2024-05-01T00:00:00Z',
    },
  };

  it('returns versions sorted descending by semver', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => fullPackument,
    });

    const result = await source.fetchVersions!({ limit: 10 });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions.map(v => v.version)).toEqual([
        '3.0.0', '2.1.0', '2.0.0', '1.1.0', '1.0.0',
      ]);
      expect(result.totalCount).toBe(5);
    }
  });

  it('paginates with offset-based cursor', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => fullPackument,
    });

    const result = await source.fetchVersions!({ limit: 2, cursor: 'offset:2' });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions.map(v => v.version)).toEqual(['2.0.0', '1.1.0']);
      expect(result.nextCursor).toBe('offset:4');
    }
  });

  it('returns no nextCursor when at end of list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => fullPackument,
    });

    const result = await source.fetchVersions!({ limit: 2, cursor: 'offset:4' });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions.map(v => v.version)).toEqual(['1.0.0']);
      expect(result.nextCursor).toBeUndefined();
    }
  });

  it('fetches the full packument URL (not /latest)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ versions: {} }),
    });

    await source.fetchVersions!();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/my-cli',
      expect.any(Object),
    );
  });

  it('includes publishedAt from time field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => fullPackument,
    });

    const result = await source.fetchVersions!({ limit: 1 });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions[0].publishedAt).toBe('2024-05-01T00:00:00Z');
    }
  });

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
    });

    const result = await source.fetchVersions!();
    expect(result.kind).toBe('error');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network error'));

    const result = await source.fetchVersions!();
    expect(result.kind).toBe('error');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: FAIL — `source.fetchVersions` is `undefined` for npm source

**Step 3: Implement fetchVersions on NpmRegistrySource**

In `src/checker/sources/npm-registry.ts`, add import and method:

```typescript
import type { VersionSource, VersionSourceResult, VersionInfo, FetchVersionsOptions, VersionListResult } from './index.js';
import semver from 'semver';

// ... inside the class, after fetchLatest:

  async fetchVersions(options?: FetchVersionsOptions): Promise<VersionListResult> {
    const limit = options?.limit ?? 20;
    const cursorStr = options?.cursor;
    const offset = cursorStr ? parseInt(cursorStr.replace('offset:', ''), 10) : 0;

    const registry = this.config.registryUrl ?? 'https://registry.npmjs.org';
    const url = `${registry}/${this.config.packageName}`;

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: options?.signal,
      });

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `npm registry responded with failure: ${response.status}`,
        };
      }

      const data = await response.json();
      const allVersions = Object.keys(data.versions ?? {});
      const sorted = allVersions
        .filter(v => semver.valid(v))
        .sort((a, b) => semver.rcompare(a, b));

      const totalCount = sorted.length;
      const sliced = sorted.slice(offset, offset + limit);

      const versions: VersionInfo[] = sliced.map(v => ({
        version: v,
        releaseUrl: `https://www.npmjs.com/package/${this.config.packageName}/v/${v}`,
        publishedAt: data.time?.[v],
      }));

      const nextOffset = offset + limit;
      const nextCursor = nextOffset < totalCount ? `offset:${nextOffset}` : undefined;

      return { kind: 'success', versions, nextCursor, totalCount };
    } catch (error) {
      return {
        kind: 'error',
        reason: `npm registry request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/checker/sources/npm-registry.ts src/checker/sources/__tests__/fetch-versions.test.ts
git commit -m "feat: implement fetchVersions for npm registry source"
```

---

### Task 4: Implement fetchVersions for JSR source

**Files:**
- Modify: `src/checker/sources/jsr.ts`
- Modify: `src/checker/sources/__tests__/fetch-versions.test.ts`

**Step 1: Write the failing tests**

Append to `src/checker/sources/__tests__/fetch-versions.test.ts`:

```typescript
describe('JsrSource.fetchVersions', () => {
  const source = createVersionSource({
    type: 'jsr',
    scope: 'std',
    name: 'path',
  });

  it('returns versions sorted descending by semver', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        versions: {
          '0.218.0': {},
          '0.219.0': {},
          '0.220.0': {},
        },
      }),
    });

    const result = await source.fetchVersions!({ limit: 10 });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions.map(v => v.version)).toEqual([
        '0.220.0', '0.219.0', '0.218.0',
      ]);
      expect(result.totalCount).toBe(3);
    }
  });

  it('paginates with offset-based cursor', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        versions: {
          '0.1.0': {},
          '0.2.0': {},
          '0.3.0': {},
          '0.4.0': {},
          '0.5.0': {},
        },
      }),
    });

    const result = await source.fetchVersions!({ limit: 2, cursor: 'offset:2' });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions.map(v => v.version)).toEqual(['0.3.0', '0.2.0']);
      expect(result.nextCursor).toBe('offset:4');
    }
  });

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const result = await source.fetchVersions!();
    expect(result.kind).toBe('error');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: FAIL — `source.fetchVersions` is `undefined` for JSR source

**Step 3: Implement fetchVersions on JsrSource**

In `src/checker/sources/jsr.ts`, add import and method:

```typescript
import type { VersionSource, VersionSourceResult, VersionInfo, FetchVersionsOptions, VersionListResult } from './index.js';
import semver from 'semver';

// ... inside the class, after fetchLatest:

  async fetchVersions(options?: FetchVersionsOptions): Promise<VersionListResult> {
    const limit = options?.limit ?? 20;
    const cursorStr = options?.cursor;
    const offset = cursorStr ? parseInt(cursorStr.replace('offset:', ''), 10) : 0;

    const url = `https://jsr.io/@${this.config.scope}/${this.config.name}/meta.json`;

    try {
      const response = await fetch(url, {
        signal: options?.signal,
      });

      if (!response.ok) {
        return {
          kind: 'error',
          reason: `JSR responded with failure: ${response.status}`,
        };
      }

      const data = await response.json();
      const allVersions = Object.keys(data.versions ?? {});
      const sorted = allVersions
        .filter(v => semver.valid(v))
        .sort((a, b) => semver.rcompare(a, b));

      const totalCount = sorted.length;
      const sliced = sorted.slice(offset, offset + limit);

      const versions: VersionInfo[] = sliced.map(v => ({
        version: v,
        releaseUrl: `https://jsr.io/@${this.config.scope}/${this.config.name}@${v}`,
      }));

      const nextOffset = offset + limit;
      const nextCursor = nextOffset < totalCount ? `offset:${nextOffset}` : undefined;

      return { kind: 'success', versions, nextCursor, totalCount };
    } catch (error) {
      return {
        kind: 'error',
        reason: `JSR request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/checker/sources/jsr.ts src/checker/sources/__tests__/fetch-versions.test.ts
git commit -m "feat: implement fetchVersions for JSR source"
```

---

### Task 5: Add standalone listVersions function

**Files:**
- Modify: `src/checker/sources/index.ts`

**Step 1: Write the failing test**

Append to `src/checker/sources/__tests__/fetch-versions.test.ts`:

```typescript
import { listVersions } from '../index.js';

describe('listVersions standalone function', () => {
  it('delegates to source.fetchVersions when available', async () => {
    const mockSource: VersionSource = {
      name: 'test',
      fetchLatest: vi.fn(),
      fetchVersions: vi.fn().mockResolvedValue({
        kind: 'success',
        versions: [{ version: '1.0.0' }],
      }),
    };

    const result = await listVersions(mockSource, { limit: 5 });
    expect(result.kind).toBe('success');
    expect(mockSource.fetchVersions).toHaveBeenCalledWith({ limit: 5 });
  });

  it('returns error when source does not support fetchVersions', async () => {
    const mockSource: VersionSource = {
      name: 'test',
      fetchLatest: vi.fn(),
    };

    const result = await listVersions(mockSource);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('not support');
    }
  });
});
```

You'll also need to add `VersionSource` to the import at the top of the test file:

```typescript
import { createVersionSource, listVersions } from '../index.js';
import type { FetchVersionsOptions, VersionListResult, VersionSource } from '../index.js';
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: FAIL — `listVersions` is not exported

**Step 3: Implement the standalone function**

In `src/checker/sources/index.ts`, add after `createVersionSource`:

```typescript
/**
 * Fetch a list of available versions from a single source.
 * Returns an error if the source does not support version listing.
 */
export async function listVersions(
  source: VersionSource,
  options?: FetchVersionsOptions,
): Promise<VersionListResult> {
  if (!source.fetchVersions) {
    return { kind: 'error', reason: `Source "${source.name}" does not support version listing` };
  }
  return source.fetchVersions(options);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/checker/sources/index.ts src/checker/sources/__tests__/fetch-versions.test.ts
git commit -m "feat: add standalone listVersions function"
```

---

### Task 6: Extend planner with targetVersion option

**Files:**
- Modify: `src/planner/index.ts:20-43`
- Modify: `src/planner/__tests__/planner.test.ts`

**Step 1: Write the failing tests**

Append to `src/planner/__tests__/planner.test.ts`:

```typescript
// ──────────────────────────────────────────────
// Downgrade / targetVersion
// ──────────────────────────────────────────────

describe('planUpdate — targetVersion option', () => {
  it('uses targetVersion instead of status.latest', () => {
    const result = planUpdate(
      available('2.0.0', '3.0.0'),
      detection('npm-global', 'high'),
      config(),
      { targetVersion: '1.0.0' },
    );
    expect(result).not.toBeNull();
    expect(result!.toVersion).toBe('1.0.0');
    expect(result!.fromVersion).toBe('2.0.0');
  });

  it('creates delegate-command with target version for npm downgrade', () => {
    const result = planUpdate(
      available('2.0.0', '3.0.0'),
      detection('npm-global', 'high'),
      config(),
      { targetVersion: '1.5.0' },
    );
    expect(result).not.toBeNull();
    if (result!.kind.type === 'delegate-command') {
      expect(result!.kind.command).toEqual(['npm', 'install', '-g', 'test-app@1.5.0']);
    }
  });

  it('creates native-in-place plan for native channel downgrade', () => {
    const result = planUpdate(
      available('2.0.0', '3.0.0'),
      detection('native', 'high'),
      config(),
      { targetVersion: '1.0.0', assets: assets() },
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('native-in-place');
    expect(result!.toVersion).toBe('1.0.0');
  });

  it('creates plan even when status is up-to-date (for explicit downgrade)', () => {
    const result = planUpdate(
      { kind: 'up-to-date', current: '2.0.0' },
      detection('npm-global', 'high'),
      config(),
      { targetVersion: '1.0.0' },
    );
    expect(result).not.toBeNull();
    expect(result!.toVersion).toBe('1.0.0');
    expect(result!.fromVersion).toBe('2.0.0');
  });

  it('returns null when targetVersion equals current version', () => {
    const result = planUpdate(
      { kind: 'up-to-date', current: '2.0.0' },
      detection('npm-global', 'high'),
      config({ currentVersion: '2.0.0' }),
      { targetVersion: '2.0.0' },
    );
    expect(result).toBeNull();
  });

  it('passes assets from options to plan resolution', () => {
    const result = planUpdate(
      available('1.0.0', '3.0.0'),
      detection('native', 'high'),
      config(),
      { targetVersion: '2.0.0', assets: assets() },
    );
    expect(result).not.toBeNull();
    expect(result!.kind.type).toBe('native-in-place');
  });

  it('works with brew-cask channel downgrade', () => {
    const result = planUpdate(
      available('2.0.0', '3.0.0'),
      detection('brew-cask', 'high'),
      config({ brewCaskName: 'my-cask' }),
      { targetVersion: '1.0.0' },
    );
    expect(result).not.toBeNull();
    if (result!.kind.type === 'delegate-command') {
      expect(result!.kind.command).toEqual(['brew', 'upgrade', '--cask', 'my-cask']);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/planner/__tests__/planner.test.ts`
Expected: FAIL — `planUpdate` doesn't accept 4th argument as options object (currently it's `assets?: AssetInfo[]`)

**Step 3: Implement the changes**

Modify `src/planner/index.ts`. Change the function signature and body:

```typescript
/** Options for planUpdate */
export interface PlanUpdateOptions {
  /** Override the target version. When set, plans for this version instead of status.latest. */
  targetVersion?: string;
  /** Release assets for native-in-place strategy */
  assets?: AssetInfo[];
}

/**
 * Create an update plan based on version status, installation detection, and configuration.
 * Pure function — no I/O, no side effects.
 *
 * Returns null if no update is needed (status is not 'available' and no targetVersion specified).
 */
export function planUpdate(
  status: UpdateStatus,
  detection: InstallDetection,
  config: ResolvedUpdateKitConfig,
  options?: AssetInfo[] | PlanUpdateOptions,
): UpdatePlan | null {
  // Normalize options: support legacy assets array or new options object
  const opts: PlanUpdateOptions = Array.isArray(options)
    ? { assets: options }
    : (options ?? {});

  const { targetVersion, assets } = opts;

  if (targetVersion) {
    // Explicit target: extract current from status or config
    const current = status.kind === 'available'
      ? status.current
      : status.kind === 'up-to-date'
        ? status.current
        : config.currentVersion;

    if (current === targetVersion) {
      return null;
    }

    const { channel, confidence } = detection;
    const kind = resolvePlanKind(channel, confidence, targetVersion, config, assets);
    const postAction = resolvePostAction(kind, confidence, config);

    return { kind, fromVersion: current, toVersion: targetVersion, postAction };
  }

  if (status.kind !== 'available') {
    return null;
  }

  const { channel, confidence } = detection;
  const fromVersion = status.current;
  const toVersion = status.latest;

  const kind = resolvePlanKind(channel, confidence, toVersion, config, assets);
  const postAction = resolvePostAction(kind, confidence, config);

  return {
    kind,
    fromVersion,
    toVersion,
    postAction,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/planner/__tests__/planner.test.ts`
Expected: ALL PASS (existing tests still work due to legacy `AssetInfo[]` support)

**Step 5: Run full test suite for regressions**

Run: `pnpm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/planner/index.ts src/planner/__tests__/planner.test.ts
git commit -m "feat: add targetVersion option to planUpdate for downgrade support"
```

---

### Task 7: Add UpdateKit.listVersions and UpdateKit.switchVersion methods

**Files:**
- Modify: `src/index.ts`
- Create: `src/__tests__/version-list-downgrade.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/version-list-downgrade.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateKit } from '../index.js';
import type { VersionListResult } from '../checker/sources/index.js';

// Mock all external dependencies
vi.mock('../detection/index.js', () => ({
  detectInstall: vi.fn().mockResolvedValue({
    channel: 'npm-global',
    confidence: 'high',
    evidence: [],
  }),
}));

vi.mock('../checker/index.js', () => ({
  checkUpdate: vi.fn().mockResolvedValue({
    kind: 'up-to-date',
    current: '2.0.0',
  }),
  normalizeVersion: vi.fn((v: string) => v),
}));

vi.mock('../applier/native.js', () => ({
  applyNativeUpdate: vi.fn(),
}));

vi.mock('../applier/delegate.js', () => ({
  applyDelegateUpdate: vi.fn().mockResolvedValue({
    kind: 'success',
    fromVersion: '2.0.0',
    toVersion: '1.0.0',
    postAction: 'exit-after-apply',
  }),
}));

vi.mock('../ux/hooks.js', () => ({
  runHook: vi.fn().mockResolvedValue(true),
}));

vi.mock('../platform/paths.js', () => ({
  getDefaultCacheDir: vi.fn().mockReturnValue('/tmp/cache'),
}));

describe('UpdateKit.listVersions', () => {
  it('returns versions from the first source that supports fetchVersions', async () => {
    const kit = new UpdateKit({
      appName: 'test-app',
      currentVersion: '2.0.0',
      sources: [{
        type: 'npm',
        packageName: 'test-app',
      }],
    });

    // Mock fetch for npm packument
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        versions: {
          '1.0.0': { version: '1.0.0' },
          '2.0.0': { version: '2.0.0' },
          '3.0.0': { version: '3.0.0' },
        },
        time: {
          '1.0.0': '2024-01-01T00:00:00Z',
          '2.0.0': '2024-02-01T00:00:00Z',
          '3.0.0': '2024-03-01T00:00:00Z',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await kit.listVersions({ limit: 10 });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.versions.length).toBeGreaterThan(0);
    }
  });

  it('returns error when no source supports version listing', async () => {
    const kit = new UpdateKit({
      appName: 'test-app',
      currentVersion: '2.0.0',
      sources: [{
        type: 'brew',
        caskName: 'test-app',
      }],
    });

    const result = await kit.listVersions();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('No source supports version listing');
    }
  });
});

describe('UpdateKit.switchVersion', () => {
  it('executes full downgrade pipeline and returns result', async () => {
    const mockFetch = vi.fn()
      // For the packument fetch (to get version info)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          version: '1.0.0',
        }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const kit = new UpdateKit({
      appName: 'test-app',
      currentVersion: '2.0.0',
      delegateMode: 'execute',
      sources: [{
        type: 'npm',
        packageName: 'test-app',
      }],
    });

    const result = await kit.switchVersion('1.0.0', { execute: true });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.toVersion).toBe('1.0.0');
    }
  });

  it('returns failed when target equals current version', async () => {
    const kit = new UpdateKit({
      appName: 'test-app',
      currentVersion: '2.0.0',
      sources: [{
        type: 'npm',
        packageName: 'test-app',
      }],
    });

    const result = await kit.switchVersion('2.0.0');
    expect(result.kind).toBe('failed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/version-list-downgrade.test.ts`
Expected: FAIL — `kit.listVersions` and `kit.switchVersion` are not defined

**Step 3: Implement the methods**

In `src/index.ts`, add the import at the top:

```typescript
import type { FetchVersionsOptions, VersionListResult } from './checker/sources/index.js';
import type { PlanUpdateOptions } from './planner/index.js';
```

Add the two methods to the `UpdateKit` class (after `autoUpdate`):

```typescript
  /**
   * List available versions with pagination.
   * Iterates sources in channel-priority order and returns results from
   * the first source that supports version listing.
   *
   * @param options - Pagination options (limit, cursor).
   * @returns Version list result, or error if no source supports listing.
   */
  async listVersions(options?: {
    limit?: number;
    cursor?: string;
  }): Promise<VersionListResult> {
    const sources = this.getEffectiveSources();

    for (const source of sources) {
      if (source.fetchVersions) {
        return source.fetchVersions(options);
      }
    }

    return { kind: 'error', reason: 'No source supports version listing' };
  }

  /**
   * Switch to a specific version (upgrade or downgrade).
   * Runs the full pipeline: detect → plan → apply.
   *
   * @param targetVersion - The version to switch to.
   * @param options - Options including whether to execute delegate commands.
   * @returns Apply result. Never throws; errors are returned as `{ kind: 'failed' }`.
   */
  async switchVersion(
    targetVersion: string,
    options?: { execute?: boolean } & ApplyOptions,
  ): Promise<ApplyResult> {
    try {
      if (targetVersion === this.config.currentVersion) {
        return {
          kind: 'failed',
          error: new Error(`Already at version ${targetVersion}`),
          rollbackSucceeded: true,
        };
      }

      const detection = await this.detectInstall();

      // Build a synthetic status for the planner
      const status: UpdateStatus = {
        kind: 'up-to-date',
        current: this.config.currentVersion,
      };

      const effectiveConfig = options?.execute
        ? { ...this.config, delegateMode: 'execute' as const }
        : this.config;

      const plan = planUpdateFn(status, detection, effectiveConfig, {
        targetVersion,
      });

      if (!plan) {
        return {
          kind: 'failed',
          error: new Error(`No plan could be created for version ${targetVersion}`),
          rollbackSucceeded: true,
        };
      }

      return await this.applyUpdate(plan, options);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { kind: 'failed', error: err, rollbackSucceeded: false };
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/version-list-downgrade.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/index.ts src/__tests__/version-list-downgrade.test.ts
git commit -m "feat: add listVersions and switchVersion methods to UpdateKit"
```

---

### Task 8: Export new types from public API

**Files:**
- Modify: `src/index.ts` (exports section)

**Step 1: Write the failing test**

Add to `src/__tests__/version-list-downgrade.test.ts`:

```typescript
import type { FetchVersionsOptions, VersionListResult } from '../index.js';
import { listVersions } from '../index.js';

describe('public API exports', () => {
  it('exports FetchVersionsOptions type', () => {
    const opts: FetchVersionsOptions = { limit: 10 };
    expect(opts.limit).toBe(10);
  });

  it('exports VersionListResult type', () => {
    const result: VersionListResult = { kind: 'error', reason: 'test' };
    expect(result.kind).toBe('error');
  });

  it('exports listVersions standalone function', () => {
    expect(typeof listVersions).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/version-list-downgrade.test.ts`
Expected: FAIL — `FetchVersionsOptions`, `VersionListResult`, and `listVersions` not exported from `../index.js`

**Step 3: Add exports**

In `src/index.ts`, update the version sources export section:

```typescript
// Version Sources
export { createVersionSource, listVersions } from './checker/sources/index.js';
export type {
  VersionSource,
  VersionSourceResult,
  VersionInfo,
  AssetInfo,
  FetchVersionsOptions,
  VersionListResult,
  GitHubSourceConfig,
  NpmSourceConfig,
  JsrSourceConfig,
  BrewSourceConfig,
  CustomManifestSourceConfig,
} from './checker/sources/index.js';
```

Also add `PlanUpdateOptions` export in the planner section (if not already present). Below the existing `planUpdate` usage, at the end of the file or in a logical export section:

```typescript
// Planner
export type { PlanUpdateOptions } from './planner/index.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/version-list-downgrade.test.ts`
Expected: PASS

**Step 5: Run full test suite and type check**

Run: `pnpm test && pnpm lint`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/index.ts src/__tests__/version-list-downgrade.test.ts
git commit -m "feat: export version listing types and functions from public API"
```

---

### Task 9: Verify no source supports fetchVersions incorrectly (Brew + Custom)

**Files:**
- Modify: `src/checker/sources/__tests__/fetch-versions.test.ts`

This task verifies that Brew source does NOT have `fetchVersions` and that `CustomManifestSource` does NOT have it (since we're not implementing it for custom manifests in this iteration).

**Step 1: Write the tests**

Append to `src/checker/sources/__tests__/fetch-versions.test.ts`:

```typescript
describe('BrewSource does not support fetchVersions', () => {
  it('does not have fetchVersions method', () => {
    const source = createVersionSource({
      type: 'brew',
      caskName: 'my-app',
    });
    expect(source.fetchVersions).toBeUndefined();
  });
});

describe('CustomManifestSource does not support fetchVersions', () => {
  it('does not have fetchVersions method', () => {
    const source = createVersionSource({
      type: 'custom',
      url: 'https://example.com/manifest.json',
    });
    expect(source.fetchVersions).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `pnpm test -- src/checker/sources/__tests__/fetch-versions.test.ts`
Expected: PASS (these sources don't implement fetchVersions)

**Step 3: Commit**

```bash
git add src/checker/sources/__tests__/fetch-versions.test.ts
git commit -m "test: verify Brew and Custom sources do not support fetchVersions"
```

---

### Task 10: Final verification and type check

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 2: Run type check**

Run: `pnpm lint`
Expected: No errors

**Step 3: Review all changes**

Run: `git log --oneline` to verify commit history is clean.

**Step 4: Final commit (if any fixups needed)**

Only if linting or tests revealed issues to fix.
