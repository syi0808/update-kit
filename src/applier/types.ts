import type { ApplyProgress } from '../types.js';

/** Options for the native update applier. */
export interface ApplyOptions {
  /** Progress callback, called at each phase transition and during download. */
  onProgress?: (progress: ApplyProgress) => void;

  /** AbortSignal for cancelling the download. */
  signal?: AbortSignal;

  /** Skip checksum verification. Default: false. Not recommended. */
  skipChecksum?: boolean;
}
