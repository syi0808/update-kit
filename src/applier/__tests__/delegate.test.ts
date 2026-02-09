import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { UpdatePlan } from '../../types.js';
import {
  UpdateKitError,
  COMMAND_FAILED,
  COMMAND_TIMEOUT,
  COMMAND_ABORTED,
  COMMAND_SPAWN_FAILED,
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

function delegatePlan(overrides?: Partial<{
  command: string[];
  channel: string;
  mode: 'print-only' | 'execute';
  fromVersion: string;
  toVersion: string;
}>): UpdatePlan {
  return {
    kind: {
      type: 'delegate-command',
      channel: overrides?.channel ?? 'npm-global',
      command: overrides?.command ?? ['npm', 'install', '-g', 'my-app@2.0.0'],
      mode: overrides?.mode ?? 'print-only',
    },
    fromVersion: overrides?.fromVersion ?? '1.0.0',
    toVersion: overrides?.toVersion ?? '2.0.0',
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

// ──────────────────────────────────────────────
// Plan validation
// ──────────────────────────────────────────────

describe('applyDelegateUpdate — plan validation', () => {
  it('throws COMMAND_FAILED for non-delegate-command plans', async () => {
    const plan: UpdatePlan = {
      kind: {
        type: 'native-in-place',
        downloadUrl: 'https://example.com/app.tar.gz',
      },
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      postAction: 'suggest-restart',
    };

    await expect(applyDelegateUpdate(plan)).rejects.toThrow(
      expect.objectContaining({ code: COMMAND_FAILED }),
    );
  });

  it('throws COMMAND_FAILED for empty command', async () => {
    const plan = delegatePlan({ command: [] });

    await expect(applyDelegateUpdate(plan)).rejects.toThrow(
      expect.objectContaining({ code: COMMAND_FAILED }),
    );
  });

  it('throws COMMAND_FAILED for disallowed command', async () => {
    const plan = delegatePlan({ command: ['rm', '-rf', '/'] });

    await expect(applyDelegateUpdate(plan)).rejects.toThrow(
      expect.objectContaining({ code: COMMAND_FAILED }),
    );
  });
});

// ──────────────────────────────────────────────
// Print-only mode
// ──────────────────────────────────────────────

describe('applyDelegateUpdate — print-only mode', () => {
  it('returns success with command message', async () => {
    const plan = delegatePlan();

    const result = await applyDelegateUpdate(plan, { mode: 'print-only' });

    expect(result.kind).toBe('success');
    expect(result.command).toEqual(['npm', 'install', '-g', 'my-app@2.0.0']);
    expect(result.message).toContain('npm install -g my-app@2.0.0');
    expect(result.fromVersion).toBe('1.0.0');
    expect(result.toVersion).toBe('2.0.0');
    expect(result.postAction).toBe('exit-after-apply');
  });

  it('does not call spawn', async () => {
    const plan = delegatePlan();

    await applyDelegateUpdate(plan, { mode: 'print-only' });

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('uses plan mode as default when options.mode not set', async () => {
    const plan = delegatePlan({ mode: 'print-only' });

    const result = await applyDelegateUpdate(plan);

    expect(result.kind).toBe('success');
    expect(result.message).toBeDefined();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('has no stdout or stderr', async () => {
    const plan = delegatePlan();

    const result = await applyDelegateUpdate(plan, { mode: 'print-only' });

    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// Execute mode — success
// ──────────────────────────────────────────────

describe('applyDelegateUpdate — execute mode', () => {
  it('returns success with stdout/stderr on exit code 0', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const plan = delegatePlan();
    const promise = applyDelegateUpdate(plan, { mode: 'execute' });

    // Simulate output
    child.stdout!.emit('data', Buffer.from('output line 1\n'));
    child.stderr!.emit('data', Buffer.from('warning\n'));
    child.emit('close', 0);

    const result = await promise;

    expect(result.kind).toBe('success');
    expect(result.stdout).toBe('output line 1\n');
    expect(result.stderr).toBe('warning\n');
    expect(result.command).toEqual(['npm', 'install', '-g', 'my-app@2.0.0']);
  });

  it('calls spawn with shell: true', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const plan = delegatePlan();
    const promise = applyDelegateUpdate(plan, { mode: 'execute' });

    child.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'npm install -g my-app@2.0.0',
      [],
      expect.objectContaining({ shell: true, stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('reports progress via onProgress callback', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const plan = delegatePlan();
    const progressEvents: any[] = [];
    const promise = applyDelegateUpdate(plan, {
      mode: 'execute',
      onProgress: (p) => progressEvents.push(p),
    });

    child.stdout!.emit('data', Buffer.from('downloading...'));
    child.stderr!.emit('data', Buffer.from('warn: something'));
    child.emit('close', 0);

    await promise;

    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0]).toMatchObject({
      phase: 'execute',
      output: 'downloading...',
      stream: 'stdout',
    });
    expect(progressEvents[1]).toMatchObject({
      phase: 'execute',
      output: 'warn: something',
      stream: 'stderr',
    });
  });
});

// ──────────────────────────────────────────────
// Execute mode — timeout
// ──────────────────────────────────────────────

describe('applyDelegateUpdate — timeout', () => {
  it('rejects with COMMAND_TIMEOUT when timeout expires', async () => {
    vi.useFakeTimers();

    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const plan = delegatePlan();
    const promise = applyDelegateUpdate(plan, {
      mode: 'execute',
      timeoutMs: 5000,
    });

    vi.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow(
      expect.objectContaining({ code: COMMAND_TIMEOUT }),
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    vi.useRealTimers();
  });
});

// ──────────────────────────────────────────────
// Execute mode — abort
// ──────────────────────────────────────────────

describe('applyDelegateUpdate — abort', () => {
  it('rejects with COMMAND_ABORTED when signal is aborted', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const controller = new AbortController();
    const plan = delegatePlan();
    const promise = applyDelegateUpdate(plan, {
      mode: 'execute',
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow(
      expect.objectContaining({ code: COMMAND_ABORTED }),
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects immediately when signal is already aborted', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const controller = new AbortController();
    controller.abort();

    const plan = delegatePlan();
    await expect(
      applyDelegateUpdate(plan, {
        mode: 'execute',
        signal: controller.signal,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: COMMAND_ABORTED }));
  });
});

// ──────────────────────────────────────────────
// Execute mode — spawn error
// ──────────────────────────────────────────────

describe('applyDelegateUpdate — spawn error', () => {
  it('rejects with COMMAND_SPAWN_FAILED on spawn error', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const plan = delegatePlan();
    const promise = applyDelegateUpdate(plan, { mode: 'execute' });

    child.emit('error', new Error('spawn ENOENT'));

    await expect(promise).rejects.toThrow(
      expect.objectContaining({ code: COMMAND_SPAWN_FAILED }),
    );
  });
});
