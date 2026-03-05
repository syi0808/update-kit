/// Default interval between update checks (20 hours in milliseconds).
pub const DEFAULT_CHECK_INTERVAL_MS: u64 = 72_000_000;

/// Default timeout for delegate commands (2 minutes in milliseconds).
pub const DEFAULT_DELEGATE_TIMEOUT_MS: u64 = 120_000;

/// Default timeout for downloads (5 minutes in milliseconds).
pub const DEFAULT_DOWNLOAD_TIMEOUT_MS: u64 = 300_000;

/// Default timeout for background update checks (10 seconds in milliseconds).
pub const DEFAULT_BACKGROUND_TIMEOUT_MS: u64 = 10_000;

/// Default timeout for HTTP fetch operations (30 seconds in milliseconds).
pub const DEFAULT_FETCH_TIMEOUT_MS: u64 = 30_000;

/// Default timeout for individual version source queries (15 seconds in milliseconds).
pub const DEFAULT_SOURCE_TIMEOUT_MS: u64 = 15_000;

/// Maximum bytes to capture from command output (10 MiB).
pub const MAX_COMMAND_OUTPUT_BYTES: usize = 10 * 1024 * 1024;
