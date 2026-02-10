import crypto from 'node:crypto';
import { UpdateKitError, INSECURE_URL } from '../errors.js';

/**
 * Validate that a URL uses HTTPS. Throws INSECURE_URL if not.
 */
export function requireHttps(url: string, context?: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    const label = context ? `${context}: ` : '';
    throw new UpdateKitError(
      INSECURE_URL,
      `${label}Only HTTPS URLs are allowed. Got: ${url}`,
    );
  }
}

/**
 * Timing-safe comparison of two hex strings.
 * Returns false immediately if lengths differ (no timing leak on length).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower.length !== bLower.length) {
    return false;
  }

  const aBuf = Buffer.from(aLower, 'utf-8');
  const bBuf = Buffer.from(bLower, 'utf-8');
  return crypto.timingSafeEqual(aBuf, bBuf);
}
