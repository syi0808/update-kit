import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  UpdateKitError,
  CHECKSUM_MISMATCH,
  CHECKSUM_MISSING,
  CHECKSUM_FETCH_FAILED,
  CHECKSUM_PARSE_FAILED,
  INSECURE_URL,
} from '../errors.js';
import { fetchWithTimeout } from '../utils/http.js';
import { timingSafeEqual } from '../utils/security.js';

/** Source of the expected checksum. Maps directly to PlanKind fields. */
export interface ChecksumInfo {
  /** Expected SHA-256 hex string, if directly provided. */
  expectedChecksum?: string;
  /** URL to a checksum file (e.g., SHA256SUMS). */
  checksumUrl?: string;
}

/**
 * Verify a downloaded file's SHA-256 checksum.
 *
 * @param filePath - Path to the downloaded file.
 * @param checksumInfo - Source of the expected checksum (direct string or URL).
 * @param options - Optional filename for matching in checksum files, and AbortSignal.
 */
export async function verifyChecksum(
  filePath: string,
  checksumInfo: ChecksumInfo,
  options?: { filename?: string; signal?: AbortSignal },
): Promise<void> {
  let expectedHash: string;

  if (checksumInfo.expectedChecksum) {
    expectedHash = checksumInfo.expectedChecksum.toLowerCase();
  } else if (checksumInfo.checksumUrl) {
    const filename = options?.filename ?? 'artifact';
    expectedHash = await fetchChecksumFromUrl(
      checksumInfo.checksumUrl,
      filename,
      options?.signal,
    );
  } else {
    throw new UpdateKitError(
      CHECKSUM_MISSING,
      'No checksum provided. Use skipChecksum option or provide a checksum.',
    );
  }

  const actualHash = await computeSha256(filePath);

  if (!timingSafeEqual(actualHash, expectedHash)) {
    throw new UpdateKitError(
      CHECKSUM_MISMATCH,
      `Checksum mismatch: expected=${expectedHash}, actual=${actualHash}`,
    );
  }
}

/** Compute the SHA-256 hash of a file using streaming. */
export async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => {
      stream.destroy();
      reject(err);
    });
  });
}

/**
 * Fetch a checksum from a URL and extract the hash for the given filename.
 *
 * Supported formats:
 * - Multi-line: "{hash}  {filename}" or "{hash} {filename}" per line
 * - Single hash: a lone 64-character hex string
 */
export async function fetchChecksumFromUrl(
  checksumUrl: string,
  filename: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!checksumUrl.startsWith('https://')) {
    throw new UpdateKitError(
      INSECURE_URL,
      'HTTPS is required for checksum URL.',
    );
  }

  const response = await fetchWithTimeout(checksumUrl, { signal, timeoutMs: 30_000 });

  if (!response.ok) {
    throw new UpdateKitError(
      CHECKSUM_FETCH_FAILED,
      `Failed to download checksum file: HTTP ${response.status}`,
    );
  }

  const text = await response.text();
  const lines = text.trim().split('\n');

  for (const line of lines) {
    // "sha256hash  filename" or "sha256hash filename" format
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (match && match[2].trim() === filename) {
      return match[1].toLowerCase();
    }
  }

  // Single hash only (no filename)
  if (lines.length === 1 && /^[a-f0-9]{64}$/i.test(lines[0].trim())) {
    return lines[0].trim().toLowerCase();
  }

  throw new UpdateKitError(
    CHECKSUM_PARSE_FAILED,
    `Could not find hash for "${filename}" in checksum file.`,
  );
}
