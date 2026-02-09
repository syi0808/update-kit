import type { ApplyResult, DelegateMode, UpdatePlan } from './types.js';
import type { UpdateKitError } from './errors.js';

/**
 * Full configuration for update-kit.
 * Only `appName` and `currentVersion` are required; all other fields have sensible defaults.
 */
export interface UpdateKitConfig {
  /** Application name (e.g. "my-cli") */
  appName: string;

  /** Currently installed version (semver string) */
  currentVersion: string;

  /** Version source list. Tried in order; first successful result is used. */
  sources?: VersionSourceConfig[];

  /** Version check interval in milliseconds. Default: 72_000_000 (20 hours) */
  checkInterval?: number;

  /** Cache directory path. Default: OS-specific standard cache path */
  cacheDir?: string;

  /** Delegate mode. Default: 'print-only' */
  delegateMode?: DelegateMode;

  /** npm package name (used for npm-global channel detection and updates) */
  npmPackageName?: string;

  /** Homebrew cask name (used for brew-cask channel detection and updates) */
  brewCaskName?: string;

  /** Whether to allow re-exec. Default: false. When true, re-executes the new binary after update. */
  allowReexec?: boolean;

  /**
   * Asset filename pattern. Uses placeholders to match platform-specific assets.
   * Example: "{app}-{version}-{target}.tar.gz"
   * Placeholders: {app}, {version}, {target}, {arch}, {ext}
   */
  assetPattern?: string;

  /** Lifecycle hooks */
  hooks?: Hooks;
}

/**
 * Lifecycle hooks.
 * Each hook accepts either a sync or async function.
 */
export interface Hooks {
  /** Called before version check. Return false to skip the check. */
  beforeCheck?: () => boolean | Promise<boolean>;

  /** Called before applying an update. Return false to skip application. */
  beforeApply?: (plan: UpdatePlan) => boolean | Promise<boolean>;

  /** Called after applying an update. Receives the result regardless of success/failure. */
  afterApply?: (result: ApplyResult) => void | Promise<void>;

  /** Called on error. Useful for logging, telemetry, etc. */
  onError?: (error: UpdateKitError) => void | Promise<void>;
}

/**
 * Version source configuration. The `type` field identifies the source kind.
 * Additional source-specific options are allowed via index signature.
 */
export interface VersionSourceConfig {
  /** Source type */
  type: 'github' | 'npm' | 'jsr' | 'brew' | 'custom';

  /** Source-specific additional settings */
  [key: string]: unknown;
}
