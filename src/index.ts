import { applyDelegateUpdate } from "./applier/delegate.js";
import { applyNativeUpdate } from "./applier/native.js";
import type { ApplyOptions } from "./applier/types.js";
import {
  checkUpdate as checkUpdateFn,
  normalizeVersion,
} from "./checker/index.js";
import {
  inferSourceConfigs,
  orderSourcesByChannel,
} from "./checker/infer-sources.js";
import type { VersionSource } from "./checker/sources/index.js";
import { createVersionSource } from "./checker/sources/index.js";
import type {
  CreateOptions,
  ResolvedUpdateKitConfig,
  UpdateKitConfig,
  VersionSourceConfig,
} from "./config.js";
import { DEFAULT_CHECK_INTERVAL_MS } from "./constants.js";
import { detectInstall as detectInstallFn } from "./detection/index.js";
import { APPLY_FAILED, UpdateKitError } from "./errors.js";
import { planUpdate as planUpdateFn } from "./planner/index.js";
import { getDefaultCacheDir } from "./platform/paths.js";
import type {
  ApplyResult,
  Channel,
  CheckMode,
  InstallDetection,
  UpdatePlan,
  UpdateStatus,
} from "./types.js";
import {
  findPackageJsonFromModule,
  getCallerFilePath,
  resolvePackageJsonFromCaller,
} from "./utils/package-json.js";
import { runHook } from "./ux/hooks.js";
import { renderBanner } from "./ux/index.js";

/**
 * Main entry point for update-kit.
 * Orchestrates installation detection, version checking, update planning,
 * and update application through a single unified API.
 *
 * @example
 * ```typescript
 * const kit = new UpdateKit({
 *   appName: 'my-cli',
 *   currentVersion: '1.0.0',
 *   sources: [{ type: 'github', owner: 'user', repo: 'my-cli' }],
 * });
 *
 * // Quick check at app startup
 * const banner = await kit.checkAndNotify();
 * if (banner) console.error(banner);
 *
 * // Or full auto-update
 * const result = await kit.autoUpdate();
 * ```
 */
export class UpdateKit {
  private readonly config: ResolvedUpdateKitConfig;
  private readonly userSources: VersionSource[];
  private readonly inferredSourceConfigs: VersionSourceConfig[];
  private readonly hasExplicitSources: boolean;

  /**
   * Create a new UpdateKit instance.
   *
   * Provide either `appName` + `currentVersion` directly, or a `pkg` object
   * (e.g. from your package.json).
   *
   * @param config - Configuration options.
   * @throws {Error} If `appName` or `currentVersion` cannot be resolved.
   *
   * @example
   * ```typescript
   * // Explicit
   * const kit = new UpdateKit({
   *   appName: 'my-cli',
   *   currentVersion: '1.0.0',
   *   sources: [{ type: 'npm', packageName: 'my-cli' }],
   * });
   *
   * // From package.json
   * import pkg from './package.json' with { type: 'json' };
   * const kit = new UpdateKit({ pkg, sources: [...] });
   * ```
   */
  constructor(config: UpdateKitConfig) {
    this.config = this.resolveAndValidateConfig(config);
    this.hasExplicitSources = Array.isArray(this.config.sources);

    if (this.hasExplicitSources) {
      this.userSources = (this.config.sources ?? []).map(createVersionSource);
      this.inferredSourceConfigs = [];
    } else {
      this.userSources = [];
      this.inferredSourceConfigs = inferSourceConfigs(this.config);
    }
  }

  /**
   * Async factory that auto-resolves appName and currentVersion from the
   * host module's package.json when they are not explicitly provided.
   *
   * When `appName`/`currentVersion`/`pkg` are all omitted, the factory
   * automatically detects the caller's file location via the V8 call stack
   * and walks up from there to find the nearest package.json.
   *
   * You can optionally pass `moduleUrl` (e.g. `import.meta.url`) to
   * explicitly specify which module's package.json to use.
   *
   * @param config - Configuration options.
   * @param options - Factory options.
   * @param options.moduleUrl - Explicit module URL override. When provided,
   *   the factory locates package.json relative to this URL instead of
   *   auto-detecting from the call stack.
   * @returns A configured UpdateKit instance.
   * @throws If no package.json with name+version is found and no explicit values provided.
   *
   * @example
   * ```typescript
   * // Auto-detects package identity from the caller's package.json
   * const kit = await UpdateKit.create({
   *   sources: [{ type: 'npm', packageName: 'my-cli' }],
   * });
   * ```
   */
  static async create(
    config?: CreateOptions,
    options?: { moduleUrl?: string },
  ): Promise<UpdateKit> {
    // Capture caller file synchronously before any await
    const callerFile = getCallerFilePath();

    const cfg = config ?? {};

    if (cfg.appName && cfg.currentVersion) {
      return new UpdateKit({
        ...cfg,
        appName: cfg.appName,
        currentVersion: cfg.currentVersion,
      });
    }

    if (cfg.pkg) {
      return new UpdateKit({ ...cfg, pkg: cfg.pkg });
    }

    // Resolve package.json: explicit moduleUrl > auto-detect from caller
    let pkgResult;
    try {
      pkgResult = options?.moduleUrl
        ? await findPackageJsonFromModule(options.moduleUrl)
        : callerFile
          ? await resolvePackageJsonFromCaller(callerFile)
          : null;
    } catch {
      pkgResult = null;
    }

    if (!pkgResult) {
      throw new Error(
        "Could not auto-detect package identity. " +
          "Provide appName and currentVersion explicitly.",
      );
    }

    // Auto-fill repository from package.json if not explicitly provided
    const repository =
      cfg.repository ?? normalizeRepository(pkgResult.repository);

    return new UpdateKit({
      ...cfg,
      ...(repository ? { repository } : {}),
      pkg: { name: pkgResult.name, version: pkgResult.version },
    });
  }

  /**
   * Detect the installation channel of the running CLI app.
   *
   * @returns Detection result with channel, confidence, and evidence.
   *
   * @example
   * ```typescript
   * const detection = await kit.detectInstall();
   * console.log(detection.channel); // 'npm-global', 'brew-cask', 'native', etc.
   * ```
   */
  async detectInstall(): Promise<InstallDetection> {
    return detectInstallFn(this.resolveExecPath(), this.config);
  }

  /**
   * Check for available updates.
   *
   * @param mode - Check mode. `'non-blocking'` (default) returns cached results immediately
   *   and spawns a background check if stale. `'blocking'` fetches from sources directly.
   * @returns Update status indicating whether an update is available.
   *
   * @example
   * ```typescript
   * const status = await kit.checkUpdate('blocking');
   * if (status.kind === 'available') {
   *   console.log(`Update available: ${status.latest}`);
   * }
   * ```
   */
  async checkUpdate(mode: CheckMode = "non-blocking"): Promise<UpdateStatus> {
    return this.performCheck(mode);
  }

  private getEffectiveSources(channel?: Channel): VersionSource[] {
    if (this.hasExplicitSources) {
      return this.userSources;
    }

    let configs = this.inferredSourceConfigs;
    if (channel) {
      configs = orderSourcesByChannel(configs, channel);
    }
    return configs.map(createVersionSource);
  }

  private async performCheck(
    mode: CheckMode,
    channel?: Channel,
  ): Promise<UpdateStatus> {
    const allowed = await runHook(this.config.hooks, "beforeCheck");
    if (allowed === false) {
      return { kind: "unknown", reason: "skipped by hook" };
    }

    const sources = this.getEffectiveSources(channel);

    return checkUpdateFn(
      {
        appName: this.config.appName,
        currentVersion: this.config.currentVersion,
        sources,
        cacheDir: this.config.cacheDir ?? getDefaultCacheDir(),
        checkInterval: this.config.checkInterval,
      },
      mode,
    );
  }

  /**
   * Create an update plan based on version status and installation detection.
   *
   * @param status - Update status from `checkUpdate()`.
   * @param detection - Installation detection from `detectInstall()`.
   * @returns Update plan, or `null` if no update is needed.
   *
   * @example
   * ```typescript
   * const plan = kit.planUpdate(status, detection);
   * if (plan) {
   *   console.log(`Plan: ${plan.kind.type} from ${plan.fromVersion} to ${plan.toVersion}`);
   * }
   * ```
   */
  planUpdate(
    status: UpdateStatus,
    detection: InstallDetection,
  ): UpdatePlan | null {
    return planUpdateFn(status, detection, this.config);
  }

  /**
   * Apply an update plan.
   *
   * @param plan - Update plan from `planUpdate()`.
   * @param options - Apply options including progress callback and abort signal.
   * @returns Apply result indicating success, failure, or restart needed.
   *
   * @example
   * ```typescript
   * const result = await kit.applyUpdate(plan, {
   *   onProgress: (p) => console.log(p.phase),
   * });
   * if (result.kind === 'success') {
   *   console.log(`Updated to ${result.toVersion}`);
   * }
   * ```
   */
  async applyUpdate(
    plan: UpdatePlan,
    options?: ApplyOptions,
  ): Promise<ApplyResult> {
    const allowed = await runHook(this.config.hooks, "beforeApply", plan);
    if (allowed === false) {
      return {
        kind: "failed",
        error: new Error("Skipped by beforeApply hook"),
        rollbackSucceeded: true,
      };
    }

    let result: ApplyResult;
    try {
      switch (plan.kind.type) {
        case "native-in-place": {
          result = await applyNativeUpdate(
            plan,
            this.resolveExecPath(),
            options,
          );
          break;
        }
        case "delegate-command":
          result = await applyDelegateUpdate(plan, {
            ...options,
            mode: this.config.delegateMode,
          });
          break;
        case "manual-install":
          result = { kind: "needs-restart", message: plan.kind.instructions };
          break;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await runHook(
        this.config.hooks,
        "onError",
        error instanceof UpdateKitError
          ? error
          : new UpdateKitError(APPLY_FAILED, err.message, { cause: err }),
      );
      return { kind: "failed", error: err, rollbackSucceeded: false };
    }

    await runHook(this.config.hooks, "afterApply", result);
    return result;
  }

  /**
   * Quick cache-based check that returns a banner string if an update is available.
   * Returns `null` if no update is available or if an error occurs.
   * Designed as a one-liner for app startup.
   *
   * @returns Banner string or `null`.
   *
   * @example
   * ```typescript
   * const banner = await kit.checkAndNotify();
   * if (banner) console.error(banner);
   * ```
   */
  async checkAndNotify(): Promise<string | null> {
    try {
      const detection = await this.detectInstall();
      const status = await this.performCheck("non-blocking", detection.channel);
      return renderBanner(status, detection);
    } catch {
      return null;
    }
  }

  /**
   * Run the full update pipeline: detect, check, plan, and apply.
   *
   * @param options - Apply options including progress callback and abort signal.
   * @returns Apply result. Never throws; errors are returned as `{ kind: 'failed' }`.
   *
   * @example
   * ```typescript
   * const result = await kit.autoUpdate();
   * if (result.kind === 'success') {
   *   console.log(`Updated to ${result.toVersion}`);
   * }
   * ```
   */
  async autoUpdate(options?: ApplyOptions): Promise<ApplyResult> {
    try {
      const detection = await this.detectInstall();
      const status = await this.performCheck("blocking", detection.channel);

      if (status.kind !== "available") {
        return {
          kind: "up-to-date",
          current:
            status.kind === "up-to-date"
              ? status.current
              : this.config.currentVersion,
        };
      }

      const assets = status.kind === "available" ? status.assets : undefined;
      const plan = planUpdateFn(status, detection, this.config, assets);
      if (!plan) {
        return {
          kind: "failed",
          error: new Error("No update plan could be created"),
          rollbackSucceeded: true,
        };
      }

      return await this.applyUpdate(plan, options);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await runHook(
        this.config.hooks,
        "onError",
        error instanceof UpdateKitError
          ? error
          : new UpdateKitError(APPLY_FAILED, err.message, { cause: err }),
      );
      return { kind: "failed", error: err, rollbackSucceeded: false };
    }
  }

  private resolveExecPath(): string {
    const execPath = this.config.executablePath ?? process.argv[1];
    if (!execPath) {
      throw new Error(
        "Cannot determine executable path. Provide executablePath in config.",
      );
    }
    return execPath;
  }

  /** @internal Exposed for testing / doctor command */
  getResolvedConfig(): ResolvedUpdateKitConfig {
    return this.config;
  }

  private resolveAndValidateConfig(
    config: UpdateKitConfig,
  ): ResolvedUpdateKitConfig {
    const appName = config.appName || config.pkg?.name;
    const currentVersion = config.currentVersion || config.pkg?.version;

    if (!appName) {
      throw new Error(
        "appName is required (provide it directly or via the pkg field)",
      );
    }
    if (!currentVersion) {
      throw new Error(
        "currentVersion is required (provide it directly or via the pkg field)",
      );
    }
    if (!normalizeVersion(currentVersion)) {
      throw new Error(`Invalid semver version: ${currentVersion}`);
    }

    return {
      checkInterval: DEFAULT_CHECK_INTERVAL_MS,
      delegateMode: "print-only",
      allowReexec: false,
      ...config,
      appName,
      currentVersion,
    };
  }
}

/**
 * Normalize the package.json repository field into the config-accepted shape.
 */
function normalizeRepository(
  repo: string | { type?: string; url?: string } | undefined,
): string | { url: string } | undefined {
  if (!repo) return undefined;
  if (typeof repo === "string") return repo;
  if (typeof repo.url === "string") return { url: repo.url };
  return undefined;
}

export { applyDelegateUpdate } from "./applier/delegate.js";
// Applier
export { applyNativeUpdate } from "./applier/native.js";
export type {
  ApplyOptions,
  DelegateApplyOptions,
  DelegateApplyResult,
} from "./applier/types.js";
export type { ChecksumInfo } from "./applier/verify.js";
export { computeSha256, verifyChecksum } from "./applier/verify.js";
// Cache
export type { CacheEntry } from "./checker/cache.js";
export type { CheckUpdateOptions } from "./checker/index.js";

// Checker
export { checkUpdate, normalizeVersion } from "./checker/index.js";
// Source inference
export {
  inferSourceConfigs,
  orderSourcesByChannel,
  parseGitHubRepository,
} from "./checker/infer-sources.js";
export type {
  AssetInfo,
  BrewSourceConfig,
  CustomManifestSourceConfig,
  GitHubSourceConfig,
  JsrSourceConfig,
  NpmSourceConfig,
  VersionInfo,
  VersionSource,
  VersionSourceResult,
} from "./checker/sources/index.js";
// Version Sources
export { createVersionSource } from "./checker/sources/index.js";
// Config
export type {
  CreateOptions,
  CustomDetector,
  Hooks,
  PackageInfo,
  PlanResolverContext,
  ResolvedUpdateKitConfig,
  UpdateKitBaseConfig,
  UpdateKitConfig,
  UpdateKitExplicitConfig,
  UpdateKitPkgConfig,
  VersionSourceConfig,
} from "./config.js";
// Constants
export {
  DEFAULT_BACKGROUND_TIMEOUT_MS,
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_DELEGATE_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_SOURCE_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
} from "./constants.js";
// Detection
export { detectInstall } from "./detection/index.js";
export type { DiagnosticCheck, DoctorReport } from "./doctor.js";
// Doctor
export { runDoctor } from "./doctor.js";
export type { ErrorCode } from "./errors.js";
// Errors
export {
  APPLY_FAILED,
  CACHE_ERROR,
  CHECKSUM_FETCH_FAILED,
  CHECKSUM_MISMATCH,
  CHECKSUM_MISSING,
  CHECKSUM_PARSE_FAILED,
  COMMAND_ABORTED,
  COMMAND_FAILED,
  COMMAND_SPAWN_FAILED,
  COMMAND_TIMEOUT,
  DETECTION_FAILED,
  DOWNLOAD_FAILED,
  EXTRACT_FAILED,
  INSECURE_URL,
  NETWORK_ERROR,
  PERMISSION_DENIED,
  UNSUPPORTED_PLATFORM,
  UpdateKitError,
  VERSION_PARSE,
} from "./errors.js";
export { atomicReplace } from "./platform/replace.js";
// Types
export type {
  ApplyProgress,
  ApplyResult,
  Channel,
  CheckMode,
  Confidence,
  DelegateMode,
  Evidence,
  InstallDetection,
  PlanKind,
  PostAction,
  UpdatePlan,
  UpdateStatus,
} from "./types.js";
export type { PackageJsonResult } from "./utils/package-json.js";
// Package.json utilities
export {
  findPackageJson,
  findPackageJsonFromModule,
  findPackageJsonFromModuleSync,
  findPackageJsonSync,
} from "./utils/package-json.js";
export {
  bold,
  dim,
  green,
  red,
  stripAnsi,
  supportsColor,
  yellow,
} from "./ux/colors.js";
export { runHook } from "./ux/hooks.js";
// UX
export { renderBanner, renderProgress, renderResult } from "./ux/index.js";
export type { MessageTemplates } from "./ux/templates.js";
export { defaultTemplates } from "./ux/templates.js";
