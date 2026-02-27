import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectFromBrew } from '../brew.js';

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

const { execFile } = await import('node:child_process');

describe('detectFromBrew', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockImplementation(
      ((_cmd: string, _args: string[], cb: Function) => {
        cb(new Error('mock: command not found'));
      }) as any,
    );
  });

  it('returns brew-cask + medium for /opt/homebrew/ path', async () => {
    const result = await detectFromBrew('/opt/homebrew/Caskroom/my-app/1.0/my-app', {
      brewCaskName: undefined,
    });
    expect(result).not.toBeNull();
    expect(result!.channel).toBe('brew-cask');
    expect(result!.confidence).toBe('medium');
    expect(result!.evidence[0].source).toBe('path_pattern');
  });

  it('returns brew-cask + medium for /usr/local/Caskroom/ path', async () => {
    const result = await detectFromBrew('/usr/local/Caskroom/my-app/1.0/my-app', {
      brewCaskName: undefined,
    });
    expect(result).not.toBeNull();
    expect(result!.channel).toBe('brew-cask');
  });

  it('returns brew-cask + medium for /usr/local/Cellar/ path', async () => {
    const result = await detectFromBrew('/usr/local/Cellar/my-app/1.0/bin/my-app', {
      brewCaskName: undefined,
    });
    expect(result).not.toBeNull();
    expect(result!.channel).toBe('brew-cask');
  });

  it('returns brew-cask + medium for /home/linuxbrew/ path', async () => {
    const result = await detectFromBrew('/home/linuxbrew/.linuxbrew/bin/my-app', {
      brewCaskName: undefined,
    });
    expect(result).not.toBeNull();
    expect(result!.channel).toBe('brew-cask');
  });

  it('upgrades to high confidence when brew list --cask succeeds', async () => {
    vi.mocked(execFile).mockImplementation(
      ((_cmd: string, _args: string[], cb: Function) => {
        cb(null, 'my-app\n', '');
      }) as any,
    );

    const result = await detectFromBrew('/opt/homebrew/Caskroom/my-app/1.0/my-app', {
      brewCaskName: 'my-app',
    });
    expect(result!.confidence).toBe('high');
    expect(result!.evidence).toHaveLength(2);
    expect(result!.evidence[1].source).toBe('brew_list');
  });

  it('stays at medium when brew list --cask fails', async () => {
    const result = await detectFromBrew('/opt/homebrew/Caskroom/my-app/1.0/my-app', {
      brewCaskName: 'my-app',
    });
    expect(result!.confidence).toBe('medium');
    expect(result!.evidence).toHaveLength(2);
    expect(result!.evidence[1].detail).toContain('verification failed');
  });

  it('skips brew list when brewCaskName is not provided', async () => {
    const result = await detectFromBrew('/opt/homebrew/Caskroom/my-app/1.0/my-app', {
      brewCaskName: undefined,
    });
    expect(result!.evidence).toHaveLength(1);
  });

  it('returns null for non-homebrew path', async () => {
    const result = await detectFromBrew('/usr/local/bin/my-app', {
      brewCaskName: undefined,
    });
    expect(result).toBeNull();
  });
});
