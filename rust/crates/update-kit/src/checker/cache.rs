use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::errors::UpdateKitError;

/// A cached update check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub latest_version: String,
    pub current_version_at_check: String,
    pub last_checked_at: String,
    pub source: String,
    pub etag: Option<String>,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
}

/// Returns the path to the cache file for the given app.
fn cache_file_path(cache_dir: &Path, app_name: &str) -> std::path::PathBuf {
    cache_dir.join(app_name).join("update-check.json")
}

/// Returns the current time as milliseconds since the Unix epoch, as a string.
fn now_ms() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

/// Read the cached update check for the given app.
/// Returns `None` on any error (missing file, invalid JSON, etc.).
pub fn read_cache(cache_dir: &Path, app_name: &str) -> Option<CacheEntry> {
    let path = cache_file_path(cache_dir, app_name);
    let data = std::fs::read_to_string(&path).ok()?;
    let entry: CacheEntry = serde_json::from_str(&data).ok()?;

    // Validate required fields are non-empty
    if entry.latest_version.is_empty()
        || entry.current_version_at_check.is_empty()
        || entry.last_checked_at.is_empty()
        || entry.source.is_empty()
    {
        return None;
    }

    Some(entry)
}

/// Write a cache entry atomically (temp file + rename).
/// Creates directories if needed.
pub fn write_cache(
    cache_dir: &Path,
    app_name: &str,
    entry: &CacheEntry,
) -> Result<(), UpdateKitError> {
    let dir = cache_dir.join(app_name);
    std::fs::create_dir_all(&dir).map_err(|e| {
        UpdateKitError::CacheError(format!("Failed to create cache directory: {}", e))
    })?;

    let path = cache_file_path(cache_dir, app_name);
    let json = serde_json::to_string_pretty(entry)
        .map_err(|e| UpdateKitError::CacheError(format!("Failed to serialize cache: {}", e)))?;

    // Write to a temp file in the same directory, then rename for atomicity.
    let temp_path = dir.join("update-check.json.tmp");
    std::fs::write(&temp_path, json.as_bytes()).map_err(|e| {
        UpdateKitError::CacheError(format!("Failed to write temp cache file: {}", e))
    })?;

    std::fs::rename(&temp_path, &path).map_err(|e| {
        UpdateKitError::CacheError(format!("Failed to rename cache file: {}", e))
    })?;

    Ok(())
}

/// Check if a cache entry is stale based on the given interval (in milliseconds).
pub fn is_cache_stale(entry: &CacheEntry, interval_ms: u64) -> bool {
    let checked_at: u128 = match entry.last_checked_at.parse() {
        Ok(v) => v,
        Err(_) => return true, // Unparseable timestamp is considered stale
    };

    let now: u128 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    now.saturating_sub(checked_at) >= interval_ms as u128
}

/// Delete the cache file for the given app. Ignores "not found" errors.
pub fn clear_cache(cache_dir: &Path, app_name: &str) -> Result<(), UpdateKitError> {
    let path = cache_file_path(cache_dir, app_name);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(UpdateKitError::CacheError(format!(
            "Failed to clear cache: {}",
            e
        ))),
    }
}

/// Create a new `CacheEntry` with the current timestamp.
pub fn create_cache_entry(
    version: &str,
    current_version: &str,
    source_name: &str,
    etag: Option<String>,
    release_url: Option<String>,
    release_notes: Option<String>,
) -> CacheEntry {
    CacheEntry {
        latest_version: version.to_string(),
        current_version_at_check: current_version.to_string(),
        last_checked_at: now_ms(),
        source: source_name.to_string(),
        etag,
        release_url,
        release_notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_entry() -> CacheEntry {
        CacheEntry {
            latest_version: "2.0.0".into(),
            current_version_at_check: "1.0.0".into(),
            last_checked_at: now_ms(),
            source: "github".into(),
            etag: Some("abc123".into()),
            release_url: Some("https://github.com/test/test/releases/tag/v2.0.0".into()),
            release_notes: Some("Bug fixes".into()),
        }
    }

    #[test]
    fn test_write_and_read_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let entry = sample_entry();

        write_cache(tmp.path(), "my-app", &entry).unwrap();
        let read_back = read_cache(tmp.path(), "my-app").unwrap();

        assert_eq!(read_back.latest_version, entry.latest_version);
        assert_eq!(
            read_back.current_version_at_check,
            entry.current_version_at_check
        );
        assert_eq!(read_back.source, entry.source);
        assert_eq!(read_back.etag, entry.etag);
        assert_eq!(read_back.release_url, entry.release_url);
        assert_eq!(read_back.release_notes, entry.release_notes);
    }

    #[test]
    fn test_missing_cache_returns_none() {
        let tmp = TempDir::new().unwrap();
        assert!(read_cache(tmp.path(), "nonexistent-app").is_none());
    }

    #[test]
    fn test_stale_detection() {
        let mut entry = sample_entry();
        // Set last_checked_at to 10 seconds ago
        let ten_seconds_ago = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis()
            - 10_000;
        entry.last_checked_at = ten_seconds_ago.to_string();

        // With a 5-second interval, it should be stale
        assert!(is_cache_stale(&entry, 5_000));
    }

    #[test]
    fn test_fresh_cache_not_stale() {
        let entry = sample_entry(); // last_checked_at = now

        // With a 1-hour interval, it should be fresh
        assert!(!is_cache_stale(&entry, 3_600_000));
    }

    #[test]
    fn test_clear_removes_file() {
        let tmp = TempDir::new().unwrap();
        let entry = sample_entry();

        write_cache(tmp.path(), "my-app", &entry).unwrap();
        assert!(read_cache(tmp.path(), "my-app").is_some());

        clear_cache(tmp.path(), "my-app").unwrap();
        assert!(read_cache(tmp.path(), "my-app").is_none());
    }

    #[test]
    fn test_clear_nonexistent_is_ok() {
        let tmp = TempDir::new().unwrap();
        assert!(clear_cache(tmp.path(), "no-such-app").is_ok());
    }

    #[test]
    fn test_create_cache_entry() {
        let entry = create_cache_entry(
            "3.0.0",
            "2.0.0",
            "npm",
            Some("etag123".into()),
            None,
            None,
        );
        assert_eq!(entry.latest_version, "3.0.0");
        assert_eq!(entry.current_version_at_check, "2.0.0");
        assert_eq!(entry.source, "npm");
        assert_eq!(entry.etag, Some("etag123".into()));
        assert!(!entry.last_checked_at.is_empty());
    }

    #[test]
    fn test_invalid_json_returns_none() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("bad-app");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("update-check.json"), "not valid json").unwrap();
        assert!(read_cache(tmp.path(), "bad-app").is_none());
    }

    #[test]
    fn test_empty_fields_returns_none() {
        let tmp = TempDir::new().unwrap();
        let entry = CacheEntry {
            latest_version: "".into(),
            current_version_at_check: "1.0.0".into(),
            last_checked_at: now_ms(),
            source: "github".into(),
            etag: None,
            release_url: None,
            release_notes: None,
        };
        let dir = tmp.path().join("empty-app");
        std::fs::create_dir_all(&dir).unwrap();
        let json = serde_json::to_string(&entry).unwrap();
        std::fs::write(dir.join("update-check.json"), json).unwrap();
        assert!(read_cache(tmp.path(), "empty-app").is_none());
    }
}
