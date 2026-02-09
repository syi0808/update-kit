import type { UpdateKitConfig, Hooks } from './config.js';
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
  private readonly config: UpdateKitConfig;
  private readonly sources: VersionSource[];

  /**
   * Create a new UpdateKit instance.
   *
   * @param config - Configuration options. `appName` and `currentVersion` are required.
   * @throws {Error} If `appName` or `currentVersion` is missing or invalid.
   *
   * @example
   * ```typescript
   * const kit = new UpdateKit({
   *   appName: 'my-cli',
   *   currentVersion: '1.0.0',
   *   sources: [{ type: 'npm', packageName: 'my-cli' }],
   * });
   * ```
   */
  constructor(config: UpdateKitConfig) {
    this.config = this.validateConfig(config);
    this.sources = (this.config.sources ?? []).map(createVersionSource);
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
    return detectInstallFn(process.execPath, this.config);
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
        case 'native-in-place':
          result = await applyNativeUpdate(plan, process.execPath, options);
          break;
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

  private validateConfig(config: UpdateKitConfig): UpdateKitConfig {
    if (!config.appName) {
      throw new Error('appName is required');
    }
    if (!config.currentVersion) {
      throw new Error('currentVersion is required');
    }
    if (!normalizeVersion(config.currentVersion)) {
      throw new Error(`Invalid semver version: ${config.currentVersion}`);
    }
    return {
      checkInterval: 72_000_000,
      delegateMode: 'print-only',
      allowReexec: false,
      ...config,
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
