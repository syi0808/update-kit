import type { ApplyResult, DelegateMode, UpdatePlan } from './types.js';
import type { UpdateKitError } from './errors.js';

/**
 * Package identity, typically from package.json.
 */
export interface PackageInfo {
  /** Package name (maps to appName) */
  name: string;
  /** Package version (maps to currentVersion) */
  version: string;
}

/**
 * Shared configuration fields.
 */
export interface UpdateKitBaseConfig {
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

  /**
   * Path to the host CLI's executable binary.
   * Used for install channel detection and native-in-place updates.
   *
   * For compiled/standalone binaries, this is the binary itself.
   * For Node.js CLIs, this should be the entry script path (e.g. `process.argv[1]`).
   *
   * Defaults to `process.argv[1]`.
   */
  executablePath?: string;

  /** Lifecycle hooks */
  hooks?: Hooks;
}

/**
 * Config with explicit appName and currentVersion.
 */
export interface UpdateKitExplicitConfig extends UpdateKitBaseConfig {
  /** Application name (e.g. "my-cli") */
  appName: string;

  /** Currently installed version (semver string) */
  currentVersion: string;

  /** Optional package info. Explicit fields take priority. */
  pkg?: PackageInfo;
}

/**
 * Config that derives appName / currentVersion from a `pkg` object.
 */
export interface UpdateKitPkgConfig extends UpdateKitBaseConfig {
  /** Application name. Optional when pkg is provided; overrides pkg.name. */
  appName?: string;

  /** Currently installed version. Optional when pkg is provided; overrides pkg.version. */
  currentVersion?: string;

  /** Package info to derive appName and currentVersion from. */
  pkg: PackageInfo;
}

/**
 * Full configuration for update-kit.
 * Provide either `appName` + `currentVersion` directly, or a `pkg` object
 * (e.g. from your package.json).
 */
export type UpdateKitConfig = UpdateKitExplicitConfig | UpdateKitPkgConfig;

/**
 * Options for `UpdateKit.create()`. Identity fields are optional when
 * `moduleUrl` is provided to auto-resolve from the host module's package.json.
 */
export type CreateOptions = UpdateKitBaseConfig & {
  appName?: string;
  currentVersion?: string;
  pkg?: PackageInfo;
};

/**
 * Internally resolved config where appName and currentVersion are always present.
 * @internal
 */
export interface ResolvedUpdateKitConfig extends UpdateKitBaseConfig {
  appName: string;
  currentVersion: string;
  pkg?: PackageInfo;
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
