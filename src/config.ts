import type { UpdateKitError } from "./errors.js";
import type {
  ApplyResult,
  DelegateMode,
  InstallDetection,
  PlanKind,
  UpdatePlan,
} from "./types.js";

/**
 * Package identity, typically from package.json.
 */
export interface PackageInfo {
  /** Package name (maps to appName) */
  name: string;
  /** Package version (maps to currentVersion) */
  version: string;
}

// ──────────────────────────────────────────────
// Config sub-groups
// ──────────────────────────────────────────────

/**
 * Configuration fields related to install channel detection.
 */
export interface DetectionConfig {
  /** npm package name (used for npm-global channel detection and updates) */
  npmPackageName?: string;

  /** Homebrew cask name (used for brew-cask channel detection and updates) */
  brewCaskName?: string;

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

  /**
   * Custom install channel detectors, checked before built-in detectors.
   * Each detector receives the executable path and returns a detection
   * result or null to pass to the next detector.
   */
  customDetectors?: CustomDetector[];
}

/**
 * Configuration fields related to version checking.
 */
export interface CheckConfig {
  /** Version source list. Tried in order; first successful result is used. */
  sources?: VersionSourceConfig[];

  /** Version check interval in milliseconds. Default: 72_000_000 (20 hours) */
  checkInterval?: number;

  /** Cache directory path. Default: OS-specific standard cache path */
  cacheDir?: string;

  /**
   * GitHub repository URL or shorthand. Used for auto-inferring a GitHub
   * version source when `sources` is omitted.
   * Accepted formats: "https://github.com/owner/repo", "github:owner/repo",
   * "git+https://github.com/owner/repo.git", or { url: "..." }.
   * Auto-filled from package.json when using `UpdateKit.create()`.
   */
  repository?: string | { url: string };
}

/**
 * Configuration fields related to update plan generation.
 */
export interface PlanConfig {
  /** Delegate mode. Default: 'print-only' */
  delegateMode?: DelegateMode;

  /**
   * Asset filename pattern. Uses placeholders to match platform-specific assets.
   * Example: "{app}-{version}-{target}.tar.gz"
   * Placeholders: {app}, {version}, {target}, {arch}, {ext}
   */
  assetPattern?: string;

  /**
   * Custom plan resolver, called after the built-in planner produces a plan.
   * Receives the plan context including the default plan and can replace it.
   * Return null to keep the default plan.
   */
  customPlanResolver?: (context: PlanResolverContext) => PlanKind | null;
}

/**
 * Configuration fields related to update application.
 */
export interface ApplyConfig {
  /** Whether to allow re-exec. Default: false. When true, re-executes the new binary after update. */
  allowReexec?: boolean;
}

/**
 * Shared configuration fields.
 * Composed from semantic sub-groups: {@link DetectionConfig}, {@link CheckConfig},
 * {@link PlanConfig}, and {@link ApplyConfig}.
 */
export interface UpdateKitBaseConfig
  extends DetectionConfig,
    CheckConfig,
    PlanConfig,
    ApplyConfig {
  /** Lifecycle hooks */
  hooks?: Hooks;
}

/**
 * Custom install channel detector.
 */
export interface CustomDetector {
  name: string;
  detect: (
    execPath: string,
  ) => Promise<InstallDetection | null> | InstallDetection | null;
}

/**
 * Context provided to a custom plan resolver.
 */
export interface PlanResolverContext {
  channel: import("./types.js").Channel;
  confidence: import("./types.js").Confidence;
  toVersion: string;
  config: ResolvedUpdateKitConfig;
  assets?: import("./checker/sources/index.js").AssetInfo[];
  defaultPlan: PlanKind;
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

// ──────────────────────────────────────────────
// Version source configurations
// ──────────────────────────────────────────────

export interface GitHubSourceConfig {
  type: "github";
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** GitHub API token (optional, for rate limit avoidance) */
  token?: string;
  /** API base URL (for GitHub Enterprise, etc.) */
  apiBaseUrl?: string;
}

export interface NpmSourceConfig {
  type: "npm";
  /** npm package name */
  packageName: string;
  /** Registry URL (default: https://registry.npmjs.org) */
  registryUrl?: string;
}

export interface JsrSourceConfig {
  type: "jsr";
  /** Scope (without @, e.g. "std") */
  scope: string;
  /** Package name */
  name: string;
}

export interface BrewSourceConfig {
  type: "brew";
  /** Homebrew cask name */
  caskName: string;
}

export interface CustomManifestSourceConfig {
  type: "custom";
  /** Manifest JSON URL */
  url: string;
  /** Version field name (default: "version"). Supports dot-notation for nested paths (e.g. "data.latest.version") */
  versionField?: string;
}

/**
 * Version source configuration. Discriminated union by the `type` field.
 * Each variant carries only the fields relevant to that source.
 */
export type VersionSourceConfig =
  | GitHubSourceConfig
  | NpmSourceConfig
  | JsrSourceConfig
  | BrewSourceConfig
  | CustomManifestSourceConfig;
