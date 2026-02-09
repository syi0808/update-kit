import { describe, it, expect, vi, beforeEach } from 'vitest';
import { realpath, readFile, lstat, readlink } from 'node:fs/promises';
import { detectInstall } from '../index.js';

// Mock fs module
vi.mock('node:fs/promises', () => ({
  realpath: vi.fn((p: string) => Promise.resolve(p)),
  readFile: vi.fn(() => Promise.reject(new Error('ENOENT'))),
  lstat: vi.fn(() => Promise.reject(new Error('ENOENT'))),
  readlink: vi.fn(() => Promise.reject(new Error('ENOENT'))),
}));

// Mock child_process — execFile must behave as a callback-style function
vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      cb(new Error('mock: command not found'));
    },
  ),
}));

describe('detectInstall', () => {
  const config = { appName: 'test-app' };

  beforeEach(() => {
    vi.mocked(realpath).mockImplementation((p) =>
      Promise.resolve(p as string),
    );
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(lstat).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(readlink).mockRejectedValue(new Error('ENOENT'));
  });

  it('returns native + high when receipt file exists', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ appName: 'test-app', channel: 'native' }),
    );

    const result = await detectInstall('/usr/local/bin/test-app', config);
    expect(result.channel).toBe('native');
    expect(result.confidence).toBe('high');
  });

  it('returns brew-cask for Homebrew paths', async () => {
    const result = await detectInstall(
      '/opt/homebrew/Caskroom/test-app/1.0/test-app',
      config,
    );
    expect(result.channel).toBe('brew-cask');
    expect(result.confidence).toBe('medium');
  });

  it('returns npm-global for npm paths', async () => {
    const result = await detectInstall(
      '/usr/local/lib/node_modules/.bin/test-app',
      config,
    );
    expect(result.channel).toBe('npm-global');
  });

  it('falls back to unmanaged for unknown paths', async () => {
    const result = await detectInstall('/some/random/path/test-app', config);
    expect(result.channel).toBe('unmanaged');
  });
});
