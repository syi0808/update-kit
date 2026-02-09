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
