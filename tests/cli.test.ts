import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
let configPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dist-cli-'));
  configPath = join(tmpDir, 'update-kit.config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      appName: 'test-app',
      currentVersion: '1.0.0',
      sources: [],
    }),
  );
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('CLI E2E via dist/cli.mjs', () => {
  const cliPath = 'dist/cli.mjs';

  function runCli(...args: string[]): string {
    return execFileSync('node', [cliPath, ...args, '--config', configPath], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
  }

  function runCliRaw(...args: string[]): { stdout: string; stderr: string; status: number } {
    try {
      const stdout = execFileSync('node', [cliPath, ...args], {
        encoding: 'utf-8',
        timeout: 10_000,
      });
      return { stdout, stderr: '', status: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
        status: error.status ?? 1,
      };
    }
  }

  it('prints help when invoked with no arguments', () => {
    const output = execFileSync('node', [cliPath], { encoding: 'utf-8' });
    expect(output).toContain('Usage:');
    expect(output).toContain('Commands:');
  });

  it('prints help with --help flag', () => {
    const output = execFileSync('node', [cliPath, '--help'], { encoding: 'utf-8' });
    expect(output).toContain('Usage:');
  });

  it('detect command outputs valid JSON', () => {
    const output = runCli('detect', '--json');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('channel');
    expect(parsed).toHaveProperty('confidence');
    expect(parsed).toHaveProperty('evidence');
    expect(Array.isArray(parsed.evidence)).toBe(true);
  });

  it('detect command JSON has valid channel value', () => {
    const output = runCli('detect', '--json');
    const parsed = JSON.parse(output);
    expect(typeof parsed.channel).toBe('string');
    expect(parsed.channel.length).toBeGreaterThan(0);
  });

  it('detect command JSON has valid confidence value', () => {
    const output = runCli('detect', '--json');
    const parsed = JSON.parse(output);
    expect(['none', 'low', 'medium', 'high']).toContain(parsed.confidence);
  });

  it('check command produces output', () => {
    const output = runCli('check');
    expect(output).toBeTruthy();
  });

  it('cache show command works', () => {
    const output = runCli('cache', 'show');
    expect(output).toBeTruthy();
  });

  it('cache clear command works', () => {
    const output = runCli('cache', 'clear');
    expect(output.toLowerCase()).toContain('clear');
  });

  it('handles missing config file gracefully', () => {
    const result = runCliRaw('detect', '--config', '/nonexistent/path/config.json');
    expect(result.stdout + result.stderr).toBeTruthy();
  });
});
