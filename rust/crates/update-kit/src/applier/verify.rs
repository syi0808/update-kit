use std::path::Path;

use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

use crate::errors::UpdateKitError;
use crate::utils::http::fetch_with_timeout;
use crate::utils::security::{require_https, timing_safe_equal};

/// Information needed to verify a file's checksum.
pub struct ChecksumInfo {
    /// A pre-known expected SHA-256 hex digest.
    pub expected_checksum: Option<String>,
    /// URL from which to fetch a checksum file (SHA256SUMS format).
    pub checksum_url: Option<String>,
}

/// Options for checksum verification.
pub struct VerifyOptions {
    /// Filename to look for in a multi-line checksum file.
    pub filename: Option<String>,
}

/// Compute the SHA-256 hash of a file, returning the hex digest.
pub async fn compute_sha256(file_path: &Path) -> Result<String, UpdateKitError> {
    let mut file = tokio::fs::File::open(file_path).await.map_err(|e| {
        UpdateKitError::Io(std::io::Error::new(
            e.kind(),
            format!("Failed to open file for checksum: {}", file_path.display()),
        ))
    })?;

    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];

    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    let hash = hasher.finalize();
    Ok(hex::encode(hash))
}

/// Hex-encode helper (no extra dep needed, sha2 re-exports digest).
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}

/// Verify the checksum of a file.
///
/// Uses `expected_checksum` directly if provided, otherwise fetches from
/// `checksum_url`. Returns `ChecksumMissing` if neither is available.
pub async fn verify_checksum(
    file_path: &Path,
    checksum_info: &ChecksumInfo,
    options: Option<&VerifyOptions>,
) -> Result<(), UpdateKitError> {
    let expected = if let Some(ref checksum) = checksum_info.expected_checksum {
        checksum.to_lowercase()
    } else if let Some(ref url) = checksum_info.checksum_url {
        let filename = options.and_then(|o| o.filename.as_deref());
        fetch_checksum_from_url(url, filename).await?
    } else {
        return Err(UpdateKitError::ChecksumMissing(
            "No expected checksum or checksum URL provided".into(),
        ));
    };

    let actual = compute_sha256(file_path).await?;

    if !timing_safe_equal(&expected, &actual) {
        return Err(UpdateKitError::ChecksumMismatch { expected, actual });
    }

    Ok(())
}

/// Fetch a checksum value from a URL.
///
/// The URL must use HTTPS. The response body is parsed as either:
/// - A multi-line file with `"hash  filename"` or `"hash *filename"` format
/// - A single line containing only a 64-character hex string
async fn fetch_checksum_from_url(
    url: &str,
    filename: Option<&str>,
) -> Result<String, UpdateKitError> {
    require_https(url)?;

    let response = fetch_with_timeout(url, None).await.map_err(|e| {
        UpdateKitError::ChecksumFetchFailed(format!("Failed to fetch checksum from {url}: {e}"))
    })?;

    let body = response.text().await.map_err(|e| {
        UpdateKitError::ChecksumFetchFailed(format!("Failed to read checksum response: {e}"))
    })?;

    // Try to find a matching line in "hash  filename" format
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Try splitting on two-space or " *" separators (common in sha256sum output)
        let parts: Vec<&str> = if line.contains("  ") {
            line.splitn(2, "  ").collect()
        } else if line.contains(" *") {
            line.splitn(2, " *").collect()
        } else {
            continue;
        };

        if parts.len() == 2 {
            let hash = parts[0].trim();
            let name = parts[1].trim();

            // If we have a filename, match it; otherwise take the first valid line
            if let Some(fname) = filename {
                if name == fname || name.ends_with(&format!("/{fname}")) {
                    return validate_hex_hash(hash);
                }
            } else {
                return validate_hex_hash(hash);
            }
        }
    }

    // Fallback: if body is a single 64-char hex line
    let trimmed = body.trim();
    if trimmed.lines().count() == 1 && is_valid_sha256_hex(trimmed) {
        return Ok(trimmed.to_lowercase());
    }

    Err(UpdateKitError::ChecksumParseFailed(format!(
        "Could not parse checksum from {url}"
    )))
}

fn validate_hex_hash(s: &str) -> Result<String, UpdateKitError> {
    if is_valid_sha256_hex(s) {
        Ok(s.to_lowercase())
    } else {
        Err(UpdateKitError::ChecksumParseFailed(format!(
            "Invalid SHA-256 hash: {s}"
        )))
    }
}

fn is_valid_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn compute_sha256_hello_world() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("test.txt");
        tokio::fs::write(&file_path, b"hello world").await.unwrap();

        let hash = compute_sha256(&file_path).await.unwrap();
        // SHA-256 of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[tokio::test]
    async fn verify_checksum_match_succeeds() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("test.txt");
        tokio::fs::write(&file_path, b"hello world").await.unwrap();

        let info = ChecksumInfo {
            expected_checksum: Some(
                "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9".into(),
            ),
            checksum_url: None,
        };

        let result = verify_checksum(&file_path, &info, None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn verify_checksum_mismatch_errors() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("test.txt");
        tokio::fs::write(&file_path, b"hello world").await.unwrap();

        let info = ChecksumInfo {
            expected_checksum: Some(
                "0000000000000000000000000000000000000000000000000000000000000000".into(),
            ),
            checksum_url: None,
        };

        let result = verify_checksum(&file_path, &info, None).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, UpdateKitError::ChecksumMismatch { .. }),
            "Expected ChecksumMismatch, got: {err:?}"
        );
    }

    #[tokio::test]
    async fn verify_missing_checksum_errors() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("test.txt");
        tokio::fs::write(&file_path, b"hello world").await.unwrap();

        let info = ChecksumInfo {
            expected_checksum: None,
            checksum_url: None,
        };

        let result = verify_checksum(&file_path, &info, None).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, UpdateKitError::ChecksumMissing(_)),
            "Expected ChecksumMissing, got: {err:?}"
        );
    }

    #[tokio::test]
    async fn verify_checksum_case_insensitive() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("test.txt");
        tokio::fs::write(&file_path, b"hello world").await.unwrap();

        let info = ChecksumInfo {
            expected_checksum: Some(
                "B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9".into(),
            ),
            checksum_url: None,
        };

        let result = verify_checksum(&file_path, &info, None).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_is_valid_sha256_hex() {
        assert!(is_valid_sha256_hex(
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        ));
        assert!(!is_valid_sha256_hex("too_short"));
        assert!(!is_valid_sha256_hex(
            "zzzz27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        ));
    }

    #[tokio::test]
    async fn compute_sha256_empty_file() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("empty.txt");
        tokio::fs::write(&file_path, b"").await.unwrap();

        let hash = compute_sha256(&file_path).await.unwrap();
        // SHA-256 of empty string
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[tokio::test]
    async fn compute_sha256_file_not_found() {
        let dir = TempDir::new().unwrap();
        let result = compute_sha256(&dir.path().join("nonexistent.txt")).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn verify_checksum_url_http_rejected() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("test.txt");
        tokio::fs::write(&file_path, b"hello").await.unwrap();

        let info = ChecksumInfo {
            expected_checksum: None,
            checksum_url: Some("http://insecure.com/checksums.txt".into()),
        };

        let result = verify_checksum(&file_path, &info, None).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, UpdateKitError::InsecureUrl(_)),
            "Expected InsecureUrl, got: {err:?}"
        );
    }

    #[test]
    fn is_valid_sha256_hex_valid() {
        assert!(is_valid_sha256_hex(&"a".repeat(64)));
        assert!(is_valid_sha256_hex(
            "ABCDEF0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789"
        ));
    }

    #[test]
    fn is_valid_sha256_hex_invalid_length() {
        assert!(!is_valid_sha256_hex(&"a".repeat(63)));
        assert!(!is_valid_sha256_hex(&"a".repeat(65)));
        assert!(!is_valid_sha256_hex(""));
    }

    #[test]
    fn is_valid_sha256_hex_invalid_chars() {
        assert!(!is_valid_sha256_hex(&format!("{}g", "a".repeat(63))));
        assert!(!is_valid_sha256_hex(&format!("{} ", "a".repeat(63))));
    }

    #[test]
    fn validate_hex_hash_returns_lowercase() {
        let upper = "A".repeat(64);
        let result = validate_hex_hash(&upper).unwrap();
        assert_eq!(result, "a".repeat(64));
    }

    #[test]
    fn validate_hex_hash_rejects_invalid() {
        let result = validate_hex_hash("too_short");
        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), UpdateKitError::ChecksumParseFailed(_)),
            "Expected ChecksumParseFailed"
        );
    }
}
