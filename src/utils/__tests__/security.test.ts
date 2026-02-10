import { describe, it, expect } from 'vitest';
import { requireHttps, timingSafeEqual } from '../security.js';
import { UpdateKitError } from '../../errors.js';

describe('requireHttps', () => {
  it('passes for https URL', () => {
    expect(() => requireHttps('https://example.com')).not.toThrow();
  });

  it('throws INSECURE_URL for http URL', () => {
    expect(() => requireHttps('http://example.com')).toThrow(UpdateKitError);
    try {
      requireHttps('http://example.com');
    } catch (err) {
      expect((err as UpdateKitError).code).toBe('INSECURE_URL');
    }
  });

  it('throws INSECURE_URL for ftp URL', () => {
    expect(() => requireHttps('ftp://example.com')).toThrow(UpdateKitError);
  });

  it('includes context in error message when provided', () => {
    expect(() => requireHttps('http://example.com', 'download URL')).toThrow(
      /download URL/,
    );
  });
});

describe('timingSafeEqual', () => {
  it('returns true for matching strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns true regardless of case', () => {
    expect(timingSafeEqual('ABC123', 'abc123')).toBe(true);
    expect(timingSafeEqual('aBc123', 'AbC123')).toBe(true);
  });

  it('returns false for mismatched strings', () => {
    expect(timingSafeEqual('abc123', 'def456')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});
