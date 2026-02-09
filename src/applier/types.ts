import type { ApplyProgress, DelegateMode, PostAction } from '../types.js';

/** Options for the native update applier. */
export interface ApplyOptions {
  /** Progress callback, called at each phase transition and during download. */
  onProgress?: (progress: ApplyProgress) => void;

  /** AbortSignal for cancelling the download. */
  signal?: AbortSignal;

  /** Skip checksum verification. Default: false. Not recommended. */
  skipChecksum?: boolean;
}

/** Options for the delegate update applier. */
export interface DelegateApplyOptions extends ApplyOptions {
  /** Delegate mode. Default: 'print-only'. */
  mode?: DelegateMode;

  /** Command execution timeout in milliseconds. Default: 120_000. */
  timeoutMs?: number;
}

/** Result of a delegate update application. Failures are thrown as UpdateKitError. */
export interface DelegateApplyResult {
  kind: 'success';
  fromVersion: string;
  toVersion: string;
  postAction: PostAction;
  /** The command that was run (or suggested). */
  command: string[];
  /** Standard output (execute mode only). */
  stdout?: string;
  /** Standard error (execute mode only). */
  stderr?: string;
  /** Human-readable message (print-only mode). */
  message?: string;
}
