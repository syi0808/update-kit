pub mod background;
pub mod cache;
pub mod infer_sources;
pub mod sources;

use std::path::PathBuf;

use crate::constants::DEFAULT_CHECK_INTERVAL_MS;
use crate::errors::UpdateKitError;
use crate::types::{CheckMode, UpdateStatus};

use self::cache::{create_cache_entry, is_cache_stale, read_cache, write_cache};
use self::sources::{FetchOptions, VersionSource, VersionSourceResult};

/// Options for the check_update orchestrator.
pub struct CheckUpdateOptions {
    pub app_name: String,
    pub current_version: String,
    pub sources: Vec<Box<dyn VersionSource>>,
    pub cache_dir: PathBuf,
    pub check_interval: Option<u64>,
}

/// Orchestrate an update check using the configured sources and cache.
///
/// - **Blocking**: Iterates sources, fetches from the first successful one,
///   writes the result to cache, and returns the status.
/// - **Non-blocking**: Reads cache. If fresh, returns cached status. If stale,
///   spawns a background check and returns the stale cached data. If missing,
///   spawns background and returns Unknown.
pub async fn check_update(
    options: &CheckUpdateOptions,
    mode: CheckMode,
) -> Result<UpdateStatus, UpdateKitError> {
    let interval = options
        .check_interval
        .unwrap_or(DEFAULT_CHECK_INTERVAL_MS);

    match mode {
        CheckMode::Blocking => check_blocking(options, interval).await,
        CheckMode::NonBlocking => check_non_blocking(options, interval),
    }
}

async fn check_blocking(
    options: &CheckUpdateOptions,
    interval: u64,
) -> Result<UpdateStatus, UpdateKitError> {
    // Try each source in order until one succeeds
    for source in &options.sources {
        let etag = read_cache(&options.cache_dir, &options.app_name)
            .and_then(|e| e.etag.clone());

        let result = source
            .fetch_latest(FetchOptions {
                etag: etag.clone(),
            })
            .await;

        match result {
            VersionSourceResult::Found { info, etag } => {
                let entry = create_cache_entry(
                    &info.version,
                    &options.current_version,
                    source.name(),
                    etag,
                    info.release_url.clone(),
                    info.release_notes.clone(),
                );
                let _ = write_cache(&options.cache_dir, &options.app_name, &entry);

                return Ok(compare_versions(
                    &options.current_version,
                    &info.version,
                    info.release_url,
                    info.release_notes,
                    info.assets,
                ));
            }
            VersionSourceResult::NotModified { etag: _ } => {
                // Cache is still valid; read it and return
                if let Some(cached) = read_cache(&options.cache_dir, &options.app_name) {
                    if !is_cache_stale(&cached, interval) {
                        return Ok(compare_versions(
                            &options.current_version,
                            &cached.latest_version,
                            cached.release_url,
                            cached.release_notes,
                            None,
                        ));
                    }
                }
                // If cache is somehow missing/stale despite NotModified, continue
                continue;
            }
            VersionSourceResult::Error { .. } => {
                // Try next source
                continue;
            }
        }
    }

    Ok(UpdateStatus::Unknown {
        reason: "All sources failed".into(),
        cached_latest: None,
    })
}

fn check_non_blocking(
    options: &CheckUpdateOptions,
    interval: u64,
) -> Result<UpdateStatus, UpdateKitError> {
    match read_cache(&options.cache_dir, &options.app_name) {
        Some(cached) => {
            if is_cache_stale(&cached, interval) {
                // Stale - spawn background check and return stale data
                let _ = try_spawn_background(&options.app_name);
                Ok(compare_versions(
                    &options.current_version,
                    &cached.latest_version,
                    cached.release_url,
                    cached.release_notes,
                    None,
                ))
            } else {
                // Fresh cache
                Ok(compare_versions(
                    &options.current_version,
                    &cached.latest_version,
                    cached.release_url,
                    cached.release_notes,
                    None,
                ))
            }
        }
        None => {
            // No cache at all - spawn background, return Unknown
            let _ = try_spawn_background(&options.app_name);
            Ok(UpdateStatus::Unknown {
                reason: "No cached data available, background check spawned".into(),
                cached_latest: None,
            })
        }
    }
}

/// Try to spawn a background check. Errors are silently ignored since this is
/// best-effort.
fn try_spawn_background(_app_name: &str) -> Result<(), UpdateKitError> {
    let exe = std::env::current_exe().map_err(|e| {
        UpdateKitError::CommandSpawnFailed(format!("Cannot determine current exe: {}", e))
    })?;
    // In a real scenario we'd serialize config; for now just attempt the spawn
    background::spawn_background_check(&exe, "{}")
}

/// Compare current and latest versions and produce an UpdateStatus.
fn compare_versions(
    current: &str,
    latest: &str,
    release_url: Option<String>,
    release_notes: Option<String>,
    assets: Option<Vec<crate::types::AssetInfo>>,
) -> UpdateStatus {
    let current_normalized = normalize_version(current);
    let latest_normalized = normalize_version(latest);

    match (current_normalized, latest_normalized) {
        (Some(cur), Some(lat)) => {
            if lat > cur {
                UpdateStatus::Available {
                    current: cur.to_string(),
                    latest: lat.to_string(),
                    release_url,
                    release_notes,
                    assets,
                }
            } else {
                UpdateStatus::UpToDate {
                    current: cur.to_string(),
                }
            }
        }
        _ => {
            // Fall back to string comparison if semver parsing fails
            if current == latest {
                UpdateStatus::UpToDate {
                    current: current.to_string(),
                }
            } else {
                UpdateStatus::Available {
                    current: current.to_string(),
                    latest: latest.to_string(),
                    release_url,
                    release_notes,
                    assets,
                }
            }
        }
    }
}

/// Normalize a version string by stripping a leading 'v' and parsing with semver.
/// Returns `None` if the version string is not valid semver.
pub fn normalize_version(version: &str) -> Option<semver::Version> {
    let stripped = version.strip_prefix('v').unwrap_or(version);
    semver::Version::parse(stripped).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use self::sources::VersionInfo;
    use std::sync::Mutex;

    struct MockSource {
        name_val: &'static str,
        result: Mutex<Option<VersionSourceResult>>,
    }

    impl MockSource {
        fn new(name: &'static str, result: VersionSourceResult) -> Self {
            Self {
                name_val: name,
                result: Mutex::new(Some(result)),
            }
        }
    }

    #[async_trait::async_trait]
    impl VersionSource for MockSource {
        fn name(&self) -> &str {
            self.name_val
        }
        async fn fetch_latest(&self, _options: FetchOptions) -> VersionSourceResult {
            self.result
                .lock()
                .unwrap()
                .take()
                .unwrap_or(VersionSourceResult::Error {
                    reason: "Already consumed".into(),
                    status: None,
                })
        }
    }

    #[test]
    fn test_normalize_version_strips_v() {
        let v = normalize_version("v1.2.3").unwrap();
        assert_eq!(v, semver::Version::new(1, 2, 3));
    }

    #[test]
    fn test_normalize_version_without_v() {
        let v = normalize_version("1.2.3").unwrap();
        assert_eq!(v, semver::Version::new(1, 2, 3));
    }

    #[test]
    fn test_normalize_version_invalid() {
        assert!(normalize_version("not-a-version").is_none());
    }

    #[test]
    fn test_normalize_version_empty() {
        assert!(normalize_version("").is_none());
    }

    #[test]
    fn test_compare_versions_available() {
        let status = compare_versions("1.0.0", "2.0.0", None, None, None);
        assert!(matches!(status, UpdateStatus::Available { .. }));
    }

    #[test]
    fn test_compare_versions_up_to_date() {
        let status = compare_versions("2.0.0", "2.0.0", None, None, None);
        assert!(matches!(status, UpdateStatus::UpToDate { .. }));
    }

    #[test]
    fn test_compare_versions_newer_current() {
        let status = compare_versions("3.0.0", "2.0.0", None, None, None);
        assert!(matches!(status, UpdateStatus::UpToDate { .. }));
    }

    #[tokio::test]
    async fn test_check_update_blocking_no_sources() {
        let options = CheckUpdateOptions {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            sources: vec![],
            cache_dir: std::env::temp_dir().join("update-kit-test-no-sources"),
            check_interval: Some(3600000),
        };

        let result = check_update(&options, CheckMode::Blocking).await.unwrap();
        assert!(matches!(result, UpdateStatus::Unknown { .. }));
    }

    #[test]
    fn test_check_update_non_blocking_no_cache() {
        let tmp = tempfile::TempDir::new().unwrap();
        let options = CheckUpdateOptions {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            sources: vec![],
            cache_dir: tmp.path().to_path_buf(),
            check_interval: Some(3600000),
        };

        let result = check_non_blocking(&options, 3600000).unwrap();
        assert!(matches!(result, UpdateStatus::Unknown { .. }));
    }

    #[test]
    fn test_check_update_non_blocking_fresh_cache() {
        let tmp = tempfile::TempDir::new().unwrap();
        let entry = cache::create_cache_entry(
            "2.0.0",
            "1.0.0",
            "github",
            None,
            None,
            None,
        );
        cache::write_cache(tmp.path(), "test-app", &entry).unwrap();

        let options = CheckUpdateOptions {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            sources: vec![],
            cache_dir: tmp.path().to_path_buf(),
            check_interval: Some(3600000),
        };

        let result = check_non_blocking(&options, 3600000).unwrap();
        assert!(matches!(result, UpdateStatus::Available { .. }));
        if let UpdateStatus::Available { latest, .. } = &result {
            assert_eq!(latest, "2.0.0");
        }
    }

    #[tokio::test]
    async fn blocking_first_source_succeeds() {
        let tmp = tempfile::TempDir::new().unwrap();
        let source = MockSource::new(
            "github",
            VersionSourceResult::Found {
                info: VersionInfo {
                    version: "2.0.0".into(),
                    release_url: Some("https://example.com".into()),
                    release_notes: Some("notes".into()),
                    assets: None,
                    published_at: None,
                },
                etag: Some("etag1".into()),
            },
        );

        let options = CheckUpdateOptions {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            sources: vec![Box::new(source)],
            cache_dir: tmp.path().to_path_buf(),
            check_interval: Some(3600000),
        };

        let result = check_update(&options, CheckMode::Blocking).await.unwrap();
        assert!(matches!(result, UpdateStatus::Available { .. }));
        if let UpdateStatus::Available { latest, .. } = &result {
            assert_eq!(latest, "2.0.0");
        }
    }

    #[tokio::test]
    async fn blocking_first_fails_second_succeeds() {
        let tmp = tempfile::TempDir::new().unwrap();
        let source1 = MockSource::new(
            "github",
            VersionSourceResult::Error {
                reason: "Rate limited".into(),
                status: Some(429),
            },
        );
        let source2 = MockSource::new(
            "npm",
            VersionSourceResult::Found {
                info: VersionInfo {
                    version: "2.0.0".into(),
                    release_url: None,
                    release_notes: None,
                    assets: None,
                    published_at: None,
                },
                etag: None,
            },
        );

        let options = CheckUpdateOptions {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            sources: vec![Box::new(source1), Box::new(source2)],
            cache_dir: tmp.path().to_path_buf(),
            check_interval: Some(3600000),
        };

        let result = check_update(&options, CheckMode::Blocking).await.unwrap();
        assert!(matches!(result, UpdateStatus::Available { .. }));
    }

    #[tokio::test]
    async fn blocking_all_fail_returns_unknown() {
        let tmp = tempfile::TempDir::new().unwrap();
        let source = MockSource::new(
            "github",
            VersionSourceResult::Error {
                reason: "Network error".into(),
                status: None,
            },
        );

        let options = CheckUpdateOptions {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            sources: vec![Box::new(source)],
            cache_dir: tmp.path().to_path_buf(),
            check_interval: Some(3600000),
        };

        let result = check_update(&options, CheckMode::Blocking).await.unwrap();
        assert!(matches!(result, UpdateStatus::Unknown { .. }));
    }

    #[tokio::test]
    async fn blocking_writes_cache_on_success() {
        let tmp = tempfile::TempDir::new().unwrap();
        let source = MockSource::new(
            "github",
            VersionSourceResult::Found {
                info: VersionInfo {
                    version: "3.0.0".into(),
                    release_url: None,
                    release_notes: None,
                    assets: None,
                    published_at: None,
                },
                etag: None,
            },
        );

        let options = CheckUpdateOptions {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            sources: vec![Box::new(source)],
            cache_dir: tmp.path().to_path_buf(),
            check_interval: Some(3600000),
        };

        check_update(&options, CheckMode::Blocking).await.unwrap();
        // Verify cache was written
        let cached = cache::read_cache(tmp.path(), "test-app");
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().latest_version, "3.0.0");
    }

    #[tokio::test]
    async fn blocking_up_to_date_when_same_version() {
        let tmp = tempfile::TempDir::new().unwrap();
        let source = MockSource::new(
            "npm",
            VersionSourceResult::Found {
                info: VersionInfo {
                    version: "1.0.0".into(),
                    release_url: None,
                    release_notes: None,
                    assets: None,
                    published_at: None,
                },
                etag: None,
            },
        );

        let options = CheckUpdateOptions {
            app_name: "test-app".into(),
            current_version: "1.0.0".into(),
            sources: vec![Box::new(source)],
            cache_dir: tmp.path().to_path_buf(),
            check_interval: Some(3600000),
        };

        let result = check_update(&options, CheckMode::Blocking).await.unwrap();
        assert!(matches!(result, UpdateStatus::UpToDate { .. }));
    }

    #[test]
    fn compare_with_v_prefix() {
        let status = compare_versions("v1.0.0", "v2.0.0", None, None, None);
        assert!(matches!(status, UpdateStatus::Available { .. }));
    }

    #[test]
    fn compare_prerelease_less_than_release() {
        let status = compare_versions("1.0.0-beta.1", "1.0.0", None, None, None);
        assert!(matches!(status, UpdateStatus::Available { .. }));
    }

    #[test]
    fn compare_same_invalid_semver() {
        let status = compare_versions("abc", "abc", None, None, None);
        assert!(matches!(status, UpdateStatus::UpToDate { .. }));
    }

    #[test]
    fn compare_different_invalid_semver() {
        let status = compare_versions("abc", "def", None, None, None);
        assert!(matches!(status, UpdateStatus::Available { .. }));
    }

    #[test]
    fn compare_includes_release_url_and_notes() {
        let status = compare_versions(
            "1.0.0",
            "2.0.0",
            Some("https://url".into()),
            Some("notes".into()),
            None,
        );
        if let UpdateStatus::Available {
            release_url,
            release_notes,
            ..
        } = &status
        {
            assert_eq!(release_url.as_deref(), Some("https://url"));
            assert_eq!(release_notes.as_deref(), Some("notes"));
        } else {
            panic!("Expected Available");
        }
    }
}
