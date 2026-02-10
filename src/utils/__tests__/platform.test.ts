import { describe, it, expect } from 'vitest';
import { isWindows, isMacOS, isLinux } from '../platform.js';

describe('platform helpers', () => {
  it('isWindows returns correct value', () => {
    expect(isWindows()).toBe(process.platform === 'win32');
  });

  it('isMacOS returns correct value', () => {
    expect(isMacOS()).toBe(process.platform === 'darwin');
  });

  it('isLinux returns correct value', () => {
    expect(isLinux()).toBe(process.platform === 'linux');
  });

  it('exactly one platform returns true', () => {
    const trueCount = [isWindows(), isMacOS(), isLinux()].filter(Boolean).length;
    // On the current platform, at most one should be true
    // (could be 0 if running on an exotic platform like freebsd)
    expect(trueCount).toBeLessThanOrEqual(1);
  });
});
