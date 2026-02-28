// ──────────────────────────────────────────────
// Install channel detection
// ──────────────────────────────────────────────

/** Install channel. Allows known channels as well as arbitrary custom strings. */
export type Channel = 'native' | 'unmanaged' | 'npm-global' | 'brew-cask' | (string & {});

/** Detection confidence level */
export type Confidence = 'none' | 'low' | 'medium' | 'high';

/** Detection evidence. Records which source provided what information. */
export interface Evidence {
  /** Detection source (e.g. "path_pattern", "receipt_file", "brew_list") */
  source: string;
  /** Detailed description */
  detail: string;
}

/** Install channel detection result */
export interface InstallDetection {
  channel: Channel;
  confidence: Confidence;
  evidence: Evidence[];
}

// ──────────────────────────────────────────────
// Version checking
// ──────────────────────────────────────────────

/** Version check mode. "blocking" waits for result, "non-blocking" runs in background. */
export type CheckMode = 'blocking' | 'non-blocking';

/** Version check result */
export type UpdateStatus =
  | {
      kind: 'available';
      current: string;
      latest: string;
      releaseUrl?: string;
      releaseNotes?: string;
      /** Release assets (only populated by blocking checks with GitHub source) */
      assets?: import('./checker/sources/index.js').AssetInfo[];
    }
  | {
      kind: 'up-to-date';
      current: string;
    }
  | {
      kind: 'unknown';
      reason: string;
      cachedLatest?: string;
    };

// ──────────────────────────────────────────────
// Update planning
// ──────────────────────────────────────────────

/** Delegate mode. "print-only" prints the command, "execute" runs it directly. */
export type DelegateMode = 'print-only' | 'execute';

/** Update plan variant */
export type PlanKind =
  | {
      type: 'native-in-place';
      downloadUrl: string;
      checksumUrl?: string;
      expectedChecksum?: string;
    }
  | {
      type: 'delegate-command';
      channel: Channel;
      command: string[];
      mode: DelegateMode;
    }
  | {
      type: 'manual-install';
      reason: string;
      instructions: string;
      downloadUrl?: string;
    };

/** Action to perform after applying an update */
export type PostAction = 'suggest-restart' | 'exit-after-apply' | 'reexec' | 'none';

/** Complete update plan */
export interface UpdatePlan {
  kind: PlanKind;
  fromVersion: string;
  toVersion: string;
  postAction: PostAction;
}

// ──────────────────────────────────────────────
// Update application
// ──────────────────────────────────────────────

/** Apply progress. Represents each phase as a discriminated union. */
export type ApplyProgress =
  | { phase: 'downloading'; bytesDownloaded: number; totalBytes?: number }
  | { phase: 'verifying' }
  | { phase: 'extracting' }
  | { phase: 'replacing' }
  | { phase: 'executing'; output: string; stream: 'stdout' | 'stderr' }
  | { phase: 'done' };

/** Apply result */
export type ApplyResult =
  | {
      kind: 'success';
      fromVersion: string;
      toVersion: string;
      postAction: PostAction;
    }
  | {
      kind: 'up-to-date';
      current: string;
    }
  | {
      kind: 'needs-restart';
      message: string;
    }
  | {
      kind: 'failed';
      error: Error;
      rollbackSucceeded: boolean;
    };
