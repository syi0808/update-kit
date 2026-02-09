use std::sync::Arc;

use super::{FetchOptions, VersionInfo, VersionSource, VersionSourceResult};
use crate::utils::process::{CommandRunner, TokioCommandRunner};

/// A version source backed by Homebrew (brew info --json).
pub struct BrewSource {
    cask_name: String,
    cmd: Arc<dyn CommandRunner>,
}

impl BrewSource {
    pub fn new(cask_name: String) -> Self {
        Self {
            cask_name,
            cmd: Arc::new(TokioCommandRunner),
        }
    }

    pub fn with_cmd(cask_name: String, cmd: Arc<dyn CommandRunner>) -> Self {
        Self { cask_name, cmd }
    }
}

#[async_trait::async_trait]
impl VersionSource for BrewSource {
    fn name(&self) -> &str {
        "brew"
    }

    async fn fetch_latest(&self, _options: FetchOptions) -> VersionSourceResult {
        let output = match self
            .cmd
            .run("brew", &["info", "--json=v2", "--cask", &self.cask_name])
            .await
        {
            Ok(o) => o,
            Err(e) => {
                return VersionSourceResult::Error {
                    reason: format!("Failed to run brew: {}", e),
                    status: None,
                }
            }
        };

        if !output.success() {
            return VersionSourceResult::Error {
                reason: format!("brew info failed: {}", output.stderr.trim()),
                status: None,
            };
        }

        let json: serde_json::Value = match serde_json::from_str(&output.stdout) {
            Ok(j) => j,
            Err(e) => {
                return VersionSourceResult::Error {
                    reason: format!("Failed to parse brew JSON: {}", e),
                    status: None,
                }
            }
        };

        // brew info --json=v2 returns { "casks": [ { "version": "...", ... } ] }
        let version = json
            .get("casks")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|cask| cask.get("version"))
            .and_then(|v| v.as_str())
            .map(String::from);

        match version {
            Some(version) => VersionSourceResult::Found {
                info: VersionInfo {
                    version,
                    release_url: None,
                    release_notes: None,
                    assets: None,
                    published_at: None,
                },
                etag: None,
            },
            None => VersionSourceResult::Error {
                reason: "Could not find cask version in brew output".into(),
                status: None,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::test_utils::MockCommandRunner;

    #[test]
    fn test_source_name() {
        let source = BrewSource::new("my-cask".into());
        assert_eq!(source.name(), "brew");
    }

    #[tokio::test]
    async fn fetch_latest_success() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew info --json=v2 --cask my-cask",
            Ok(MockCommandRunner::success_output(
                r#"{"casks": [{"version": "4.1.0", "name": [{"name": "my-cask"}]}]}"#,
            )),
        );

        let source = BrewSource::with_cmd("my-cask".into(), Arc::new(cmd));
        let result = source.fetch_latest(FetchOptions::default()).await;

        match result {
            VersionSourceResult::Found { info, .. } => {
                assert_eq!(info.version, "4.1.0");
            }
            other => panic!("Expected Found, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_latest_brew_command_fails() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew info --json=v2 --cask my-cask",
            Ok(MockCommandRunner::failure_output(
                "Error: Cask 'my-cask' is unavailable",
            )),
        );

        let source = BrewSource::with_cmd("my-cask".into(), Arc::new(cmd));
        let result = source.fetch_latest(FetchOptions::default()).await;

        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(reason.contains("brew info failed"));
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_latest_brew_not_found() {
        // Don't register any response — will get CommandSpawnFailed
        let cmd = MockCommandRunner::new();

        let source = BrewSource::with_cmd("my-cask".into(), Arc::new(cmd));
        let result = source.fetch_latest(FetchOptions::default()).await;

        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(!reason.is_empty());
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_latest_invalid_json() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew info --json=v2 --cask my-cask",
            Ok(MockCommandRunner::success_output("not json")),
        );

        let source = BrewSource::with_cmd("my-cask".into(), Arc::new(cmd));
        let result = source.fetch_latest(FetchOptions::default()).await;

        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(reason.contains("parse"));
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_latest_empty_casks_array() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew info --json=v2 --cask my-cask",
            Ok(MockCommandRunner::success_output(r#"{"casks": []}"#)),
        );

        let source = BrewSource::with_cmd("my-cask".into(), Arc::new(cmd));
        let result = source.fetch_latest(FetchOptions::default()).await;

        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(reason.contains("version"));
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_latest_missing_version_field() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew info --json=v2 --cask my-cask",
            Ok(MockCommandRunner::success_output(
                r#"{"casks": [{"name": "my-cask"}]}"#,
            )),
        );

        let source = BrewSource::with_cmd("my-cask".into(), Arc::new(cmd));
        let result = source.fetch_latest(FetchOptions::default()).await;

        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(reason.contains("version"));
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_versions_returns_unsupported() {
        let cmd = MockCommandRunner::new();
        let source = BrewSource::with_cmd("my-cask".into(), Arc::new(cmd));
        let result = source
            .fetch_versions(super::super::FetchVersionsOptions::default())
            .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "UNSUPPORTED_OPERATION");
    }
}
