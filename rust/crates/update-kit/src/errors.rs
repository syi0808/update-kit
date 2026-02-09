use thiserror::Error;

/// All error types for update-kit operations.
#[derive(Debug, Error)]
pub enum UpdateKitError {
    #[error("Detection failed: {0}")]
    DetectionFailed(String),

    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),

    #[error("Insecure URL rejected: {0}")]
    InsecureUrl(String),

    #[error("Download failed: {0}")]
    DownloadFailed(String),

    #[error("Checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },

    #[error("Checksum missing: {0}")]
    ChecksumMissing(String),

    #[error("Checksum fetch failed: {0}")]
    ChecksumFetchFailed(String),

    #[error("Checksum parse failed: {0}")]
    ChecksumParseFailed(String),

    #[error("Extract failed: {0}")]
    ExtractFailed(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Command failed: {0}")]
    CommandFailed(String),

    #[error("Command timeout after {0}ms")]
    CommandTimeout(u64),

    #[error("Command aborted")]
    CommandAborted,

    #[error("Command spawn failed: {0}")]
    CommandSpawnFailed(String),

    #[error("Apply failed: {0}")]
    ApplyFailed(String),

    #[error("Cache error: {0}")]
    CacheError(String),

    #[error("Version parse error: {0}")]
    VersionParse(String),

    #[error("Unsupported platform: {0}")]
    UnsupportedPlatform(String),

    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl UpdateKitError {
    /// Returns a static error code string for each variant.
    pub fn code(&self) -> &'static str {
        match self {
            UpdateKitError::DetectionFailed(_) => "DETECTION_FAILED",
            UpdateKitError::NetworkError(_) => "NETWORK_ERROR",
            UpdateKitError::InsecureUrl(_) => "INSECURE_URL",
            UpdateKitError::DownloadFailed(_) => "DOWNLOAD_FAILED",
            UpdateKitError::ChecksumMismatch { .. } => "CHECKSUM_MISMATCH",
            UpdateKitError::ChecksumMissing(_) => "CHECKSUM_MISSING",
            UpdateKitError::ChecksumFetchFailed(_) => "CHECKSUM_FETCH_FAILED",
            UpdateKitError::ChecksumParseFailed(_) => "CHECKSUM_PARSE_FAILED",
            UpdateKitError::ExtractFailed(_) => "EXTRACT_FAILED",
            UpdateKitError::PermissionDenied(_) => "PERMISSION_DENIED",
            UpdateKitError::CommandFailed(_) => "COMMAND_FAILED",
            UpdateKitError::CommandTimeout(_) => "COMMAND_TIMEOUT",
            UpdateKitError::CommandAborted => "COMMAND_ABORTED",
            UpdateKitError::CommandSpawnFailed(_) => "COMMAND_SPAWN_FAILED",
            UpdateKitError::ApplyFailed(_) => "APPLY_FAILED",
            UpdateKitError::CacheError(_) => "CACHE_ERROR",
            UpdateKitError::VersionParse(_) => "VERSION_PARSE",
            UpdateKitError::UnsupportedPlatform(_) => "UNSUPPORTED_PLATFORM",
            UpdateKitError::UnsupportedOperation(_) => "UNSUPPORTED_OPERATION",
            UpdateKitError::Io(_) => "IO_ERROR",
            UpdateKitError::Json(_) => "JSON_ERROR",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_detection_failed() {
        let err = UpdateKitError::DetectionFailed("no receipt".into());
        assert_eq!(err.to_string(), "Detection failed: no receipt");
    }

    #[test]
    fn test_display_checksum_mismatch() {
        let err = UpdateKitError::ChecksumMismatch {
            expected: "abc123".into(),
            actual: "def456".into(),
        };
        assert_eq!(
            err.to_string(),
            "Checksum mismatch: expected abc123, got def456"
        );
    }

    #[test]
    fn test_display_command_timeout() {
        let err = UpdateKitError::CommandTimeout(5000);
        assert_eq!(err.to_string(), "Command timeout after 5000ms");
    }

    #[test]
    fn test_display_command_aborted() {
        let err = UpdateKitError::CommandAborted;
        assert_eq!(err.to_string(), "Command aborted");
    }

    #[test]
    fn test_code_values() {
        assert_eq!(
            UpdateKitError::DetectionFailed("x".into()).code(),
            "DETECTION_FAILED"
        );
        assert_eq!(UpdateKitError::InsecureUrl("x".into()).code(), "INSECURE_URL");
        assert_eq!(
            UpdateKitError::ChecksumMismatch {
                expected: "a".into(),
                actual: "b".into()
            }
            .code(),
            "CHECKSUM_MISMATCH"
        );
        assert_eq!(UpdateKitError::CommandTimeout(100).code(), "COMMAND_TIMEOUT");
        assert_eq!(UpdateKitError::CommandAborted.code(), "COMMAND_ABORTED");
        assert_eq!(
            UpdateKitError::VersionParse("bad".into()).code(),
            "VERSION_PARSE"
        );
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let err: UpdateKitError = io_err.into();
        assert_eq!(err.code(), "IO_ERROR");
        assert!(err.to_string().contains("file not found"));
    }

    #[test]
    fn test_from_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid").unwrap_err();
        let err: UpdateKitError = json_err.into();
        assert_eq!(err.code(), "JSON_ERROR");
    }
}
