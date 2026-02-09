/**
 * Base error class for all update-kit errors.
 * Provides a structured `code` field for programmatic error handling.
 */
export class UpdateKitError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'UpdateKitError';
    this.code = code;

    // Restore prototype chain for pre-ES2022 environments
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ──────────────────────────────────────────────
// Error code constants
// ──────────────────────────────────────────────

/** Install channel detection failed */
export const DETECTION_FAILED = 'DETECTION_FAILED' as const;

/** Network request failed (timeout, DNS failure, etc.) */
export const NETWORK_ERROR = 'NETWORK_ERROR' as const;

/** Cache read/write failure */
export const CACHE_ERROR = 'CACHE_ERROR' as const;

/** Version string parse failure */
export const VERSION_PARSE = 'VERSION_PARSE' as const;

/** Downloaded file checksum mismatch */
export const CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH' as const;

/** Signature verification failed */
export const SIGNATURE_INVALID = 'SIGNATURE_INVALID' as const;

/** User or hook rejected the update plan */
export const PLAN_REJECTED = 'PLAN_REJECTED' as const;

/** Update application failed */
export const APPLY_FAILED = 'APPLY_FAILED' as const;

/** External command execution failed */
export const COMMAND_FAILED = 'COMMAND_FAILED' as const;

/** Feature not supported on current platform */
export const UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM' as const;

/** Insufficient file system permissions */
export const PERMISSION_DENIED = 'PERMISSION_DENIED' as const;

/** HTTP URL rejected; HTTPS is required */
export const INSECURE_URL = 'INSECURE_URL' as const;

/** HTTP error response or empty response body during download */
export const DOWNLOAD_FAILED = 'DOWNLOAD_FAILED' as const;

/** No checksum provided and skipChecksum is false */
export const CHECKSUM_MISSING = 'CHECKSUM_MISSING' as const;

/** Failed to download checksum file from URL */
export const CHECKSUM_FETCH_FAILED = 'CHECKSUM_FETCH_FAILED' as const;

/** Checksum file could not be parsed or target filename not found */
export const CHECKSUM_PARSE_FAILED = 'CHECKSUM_PARSE_FAILED' as const;

/** Archive extraction failure */
export const EXTRACT_FAILED = 'EXTRACT_FAILED' as const;

/** Delegate command exceeded timeout */
export const COMMAND_TIMEOUT = 'COMMAND_TIMEOUT' as const;

/** Delegate command cancelled via AbortSignal */
export const COMMAND_ABORTED = 'COMMAND_ABORTED' as const;

/** Delegate command spawn failed (e.g. binary not found) */
export const COMMAND_SPAWN_FAILED = 'COMMAND_SPAWN_FAILED' as const;

/** Union of all error codes */
export type ErrorCode =
  | typeof DETECTION_FAILED
  | typeof NETWORK_ERROR
  | typeof CACHE_ERROR
  | typeof VERSION_PARSE
  | typeof CHECKSUM_MISMATCH
  | typeof SIGNATURE_INVALID
  | typeof PLAN_REJECTED
  | typeof APPLY_FAILED
  | typeof COMMAND_FAILED
  | typeof UNSUPPORTED_PLATFORM
  | typeof PERMISSION_DENIED
  | typeof INSECURE_URL
  | typeof DOWNLOAD_FAILED
  | typeof CHECKSUM_MISSING
  | typeof CHECKSUM_FETCH_FAILED
  | typeof CHECKSUM_PARSE_FAILED
  | typeof EXTRACT_FAILED
  | typeof COMMAND_TIMEOUT
  | typeof COMMAND_ABORTED
  | typeof COMMAND_SPAWN_FAILED;
