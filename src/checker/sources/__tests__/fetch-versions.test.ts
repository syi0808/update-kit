import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVersionSource, listVersions } from '../index.js';
import type { FetchVersionsOptions, VersionListResult, VersionSource } from '../index.js';

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

  it('returns error for invalid cursor', async () => {
    const result = await source.fetchVersions!({ cursor: 'invalid' });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('Invalid pagination cursor');
    }
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

  it('returns error for invalid cursor', async () => {
    const result = await source.fetchVersions!({ cursor: 'invalid' });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('Invalid pagination cursor');
    }
  });
});

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

  it('returns error for invalid cursor', async () => {
    const result = await source.fetchVersions!({ cursor: 'invalid' });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.reason).toContain('Invalid pagination cursor');
    }
  });
});

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
