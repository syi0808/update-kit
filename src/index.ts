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
} from './errors.js';
export type { ErrorCode } from './errors.js';

// Config
export type {
  UpdateKitConfig,
  Hooks,
  VersionSourceConfig,
} from './config.js';
