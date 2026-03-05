use crate::errors::UpdateKitError;

/// Validates that the given URL uses HTTPS.
///
/// Returns `InsecureUrl` error if the URL does not start with `https://`.
pub fn require_https(url: &str) -> Result<(), UpdateKitError> {
    if !url.starts_with("https://") {
        return Err(UpdateKitError::InsecureUrl(format!(
            "Only HTTPS URLs are allowed. Got: {url}"
        )));
    }
    Ok(())
}

/// Constant-time comparison of two hex strings (case-insensitive).
///
/// Returns `true` if both strings are equal (ignoring case), using XOR
/// accumulation to avoid timing side-channels.
pub fn timing_safe_equal(a: &str, b: &str) -> bool {
    let a_lower = a.to_ascii_lowercase();
    let b_lower = b.to_ascii_lowercase();

    if a_lower.len() != b_lower.len() {
        return false;
    }

    let result = a_lower
        .as_bytes()
        .iter()
        .zip(b_lower.as_bytes().iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y));

    result == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_https_accepts_https() {
        assert!(require_https("https://example.com").is_ok());
        assert!(require_https("https://example.com/path?q=1").is_ok());
    }

    #[test]
    fn require_https_rejects_http() {
        let result = require_https("http://example.com");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, UpdateKitError::InsecureUrl(_)),
            "Expected InsecureUrl, got: {err:?}"
        );
    }

    #[test]
    fn require_https_rejects_other_schemes() {
        assert!(require_https("ftp://example.com").is_err());
        assert!(require_https("file:///etc/passwd").is_err());
        assert!(require_https("").is_err());
    }

    #[test]
    fn timing_safe_equal_matches_same() {
        assert!(timing_safe_equal("abc123", "abc123"));
    }

    #[test]
    fn timing_safe_equal_matches_case_insensitively() {
        assert!(timing_safe_equal("ABC123", "abc123"));
        assert!(timing_safe_equal("AbCdEf", "abcdef"));
    }

    #[test]
    fn timing_safe_equal_rejects_different_strings() {
        assert!(!timing_safe_equal("abc123", "abc124"));
        assert!(!timing_safe_equal("abc123", "xyz789"));
    }

    #[test]
    fn timing_safe_equal_rejects_different_lengths() {
        assert!(!timing_safe_equal("abc", "abcd"));
        assert!(!timing_safe_equal("", "a"));
    }

    #[test]
    fn timing_safe_equal_empty_strings() {
        assert!(timing_safe_equal("", ""));
    }
}
