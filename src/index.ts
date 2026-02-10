import type {
  UpdateKitConfig,
  CreateOptions,
  ResolvedUpdateKitConfig,
} from './config.js';
import type {
  CheckMode,
  UpdateStatus,
  UpdatePlan,
  InstallDetection,
  ApplyResult,
} from './types.js';
import type { ApplyOptions } from './applier/types.js';
import type { VersionSource } from './checker/sources/index.js';
import { detectInstall as detectInstallFn } from './detection/index.js';
import { checkUpdate as checkUpdateFn } from './checker/index.js';
import { normalizeVersion } from './checker/index.js';
import { createVersionSource } from './checker/sources/index.js';
import { planUpdate as planUpdateFn } from './planner/index.js';
import { applyNativeUpdate } from './applier/native.js';
import { applyDelegateUpdate } from './applier/delegate.js';
import { renderBanner } from './ux/index.js';
import { runHook } from './ux/hooks.js';
import { getDefaultCacheDir } from './platform/paths.js';
import { UpdateKitError, APPLY_FAILED } from './errors.js';
import { findPackageJsonFromModule } from './utils/package-json.js';

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
  private readonly sources: VersionSource[];

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
    this.sources = (this.config.sources ?? []).map(createVersionSource);
  }

  /**
   * Async factory that auto-resolves appName and currentVersion from the
   * host module's package.json when they are not explicitly provided.
   *
   * When `appName`/`currentVersion`/`pkg` are all omitted, the factory
   * requires `moduleUrl` (the caller's `import.meta.url`) to locate
   * the correct package.json relative to the host module — NOT the
   * end-user's working directory.
   *
   * @param config - Configuration options.
   * @param options - Factory options.
   * @param options.moduleUrl - The caller's `import.meta.url`, used to find the
   *   host package's package.json. Required when identity fields are omitted.
   * @returns A configured UpdateKit instance.
   * @throws If no package.json with name+version is found and no explicit values provided.
   *
   * @example
   * ```typescript
   * const kit = await UpdateKit.create(
   *   { sources: [{ type: 'npm', packageName: 'my-cli' }] },
   *   { moduleUrl: import.meta.url },
   * );
   * ```
   */
  static async create(
    config?: CreateOptions,
    options?: { moduleUrl?: string },
  ): Promise<UpdateKit> {
    const cfg = config ?? {};

    if (cfg.appName && cfg.currentVersion) {
      return new UpdateKit(cfg as UpdateKitConfig);
    }

    if (cfg.pkg) {
      return new UpdateKit({ ...cfg, pkg: cfg.pkg } as UpdateKitConfig);
    }

    if (!options?.moduleUrl) {
      throw new Error(
        'When appName/currentVersion/pkg are not provided, you must pass ' +
          '{ moduleUrl: import.meta.url } so update-kit can locate your package.json. ' +
          'Alternatively, provide appName and currentVersion explicitly.',
      );
    }

    const pkgResult = await findPackageJsonFromModule(options.moduleUrl);
    if (!pkgResult) {
      throw new Error(
        'Could not find a package.json with "name" and "version" fields ' +
          `starting from module at ${options.moduleUrl}. ` +
          'Provide appName and currentVersion explicitly.',
      );
    }

    return new UpdateKit({
      ...cfg,
      pkg: { name: pkgResult.name, version: pkgResult.version },
    } as UpdateKitConfig);
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
    const execPath = this.config.executablePath ?? process.argv[1];
    return detectInstallFn(execPath, this.config);
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
  async checkUpdate(mode: CheckMode = 'non-blocking'): Promise<UpdateStatus> {
    const allowed = await runHook(this.config.hooks, 'beforeCheck');
    if (allowed === false) {
      return { kind: 'unknown', reason: 'skipped by hook' };
    }

    return checkUpdateFn(
      {
        appName: this.config.appName,
        currentVersion: this.config.currentVersion,
        sources: this.sources,
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
  planUpdate(status: UpdateStatus, detection: InstallDetection): UpdatePlan | null {
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
  async applyUpdate(plan: UpdatePlan, options?: ApplyOptions): Promise<ApplyResult> {
    const allowed = await runHook(this.config.hooks, 'beforeApply', plan);
    if (allowed === false) {
      return {
        kind: 'failed',
        error: new Error('Skipped by beforeApply hook'),
        rollbackSucceeded: true,
      };
    }

    let result: ApplyResult;
    try {
      switch (plan.kind.type) {
        case 'native-in-place': {
          const execPath = this.config.executablePath ?? process.argv[1];
          result = await applyNativeUpdate(plan, execPath, options);
          break;
        }
        case 'delegate-command':
          result = await applyDelegateUpdate(plan, {
            ...options,
            mode: this.config.delegateMode,
          });
          break;
        case 'manual-install':
          result = { kind: 'needs-restart', message: plan.kind.instructions };
          break;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await runHook(
        this.config.hooks,
        'onError',
        error instanceof UpdateKitError
          ? error
          : new UpdateKitError(APPLY_FAILED, err.message, { cause: err }),
      );
      return { kind: 'failed', error: err, rollbackSucceeded: false };
    }

    await runHook(this.config.hooks, 'afterApply', result);
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
      const status = await this.checkUpdate('non-blocking');
      const detection = await this.detectInstall();
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
      const status = await this.checkUpdate('blocking');

      if (status.kind !== 'available') {
        return {
          kind: 'failed',
          error: new Error('No update available'),
          rollbackSucceeded: true,
        };
      }

      const plan = this.planUpdate(status, detection);
      if (!plan) {
        return {
          kind: 'failed',
          error: new Error('No update plan could be created'),
          rollbackSucceeded: true,
        };
      }

      return await this.applyUpdate(plan, options);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await runHook(
        this.config.hooks,
        'onError',
        error instanceof UpdateKitError
          ? error
          : new UpdateKitError(APPLY_FAILED, err.message, { cause: err }),
      );
      return { kind: 'failed', error: err, rollbackSucceeded: false };
    }
  }

  private resolveAndValidateConfig(config: UpdateKitConfig): ResolvedUpdateKitConfig {
    const appName = config.appName || config.pkg?.name;
    const currentVersion = config.currentVersion || config.pkg?.version;

    if (!appName) {
      throw new Error(
        'appName is required (provide it directly or via the pkg field)',
      );
    }
    if (!currentVersion) {
      throw new Error(
        'currentVersion is required (provide it directly or via the pkg field)',
      );
    }
    if (!normalizeVersion(currentVersion)) {
      throw new Error(`Invalid semver version: ${currentVersion}`);
    }

    return {
      checkInterval: 72_000_000,
      delegateMode: 'print-only',
      allowReexec: false,
      ...config,
      appName,
      currentVersion,
    };
  }
}

// Types
export type {
  Channel,
  Confidence,
  Evidence,
  InstallDetection,
  CheckMode,
  UpdateStatus,
  DelegateMode,
  PlanKind,
  PostAction,
  UpdatePlan,
  ApplyProgress,
  ApplyResult,
} from './types.js';

// Errors
export {
  UpdateKitError,
  DETECTION_FAILED,
  NETWORK_ERROR,
  CACHE_ERROR,
  VERSION_PARSE,
  CHECKSUM_MISMATCH,
  SIGNATURE_INVALID,
  PLAN_REJECTED,
  APPLY_FAILED,
  COMMAND_FAILED,
  UNSUPPORTED_PLATFORM,
  PERMISSION_DENIED,
  INSECURE_URL,
  DOWNLOAD_FAILED,
  CHECKSUM_MISSING,
  CHECKSUM_FETCH_FAILED,
  CHECKSUM_PARSE_FAILED,
  EXTRACT_FAILED,
  COMMAND_TIMEOUT,
  COMMAND_ABORTED,
  COMMAND_SPAWN_FAILED,
} from './errors.js';
export type { ErrorCode } from './errors.js';

// Config
export type {
  UpdateKitConfig,
  UpdateKitBaseConfig,
  UpdateKitExplicitConfig,
  UpdateKitPkgConfig,
  CreateOptions,
  ResolvedUpdateKitConfig,
  PackageInfo,
  Hooks,
  VersionSourceConfig,
} from './config.js';

// Detection
export { detectInstall } from './detection/index.js';

// Version Sources
export { createVersionSource } from './checker/sources/index.js';
export type {
  VersionSource,
  VersionSourceResult,
  VersionInfo,
  AssetInfo,
  GitHubSourceConfig,
  NpmSourceConfig,
  JsrSourceConfig,
  BrewSourceConfig,
  CustomManifestSourceConfig,
} from './checker/sources/index.js';

// Checker
export { checkUpdate, normalizeVersion } from './checker/index.js';
export type { CheckUpdateOptions } from './checker/index.js';

// Cache
export type { CacheEntry } from './checker/cache.js';

// Applier
export { applyNativeUpdate } from './applier/native.js';
export { applyDelegateUpdate } from './applier/delegate.js';
export type { ApplyOptions, DelegateApplyOptions, DelegateApplyResult } from './applier/types.js';
export { verifyChecksum, computeSha256 } from './applier/verify.js';
export type { ChecksumInfo } from './applier/verify.js';
export { atomicReplace } from './platform/replace.js';

// UX
export { renderBanner, renderProgress, renderResult } from './ux/index.js';
export { defaultTemplates } from './ux/templates.js';
export type { MessageTemplates } from './ux/templates.js';
export { supportsColor, bold, red, green, yellow, dim, stripAnsi } from './ux/colors.js';
export { runHook } from './ux/hooks.js';

// Package.json utilities
export {
  findPackageJson,
  findPackageJsonSync,
  findPackageJsonFromModule,
  findPackageJsonFromModuleSync,
} from './utils/package-json.js';
export type { PackageJsonResult } from './utils/package-json.js';
