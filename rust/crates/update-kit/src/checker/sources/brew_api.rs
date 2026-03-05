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

    #[test]
    fn test_source_name() {
        let source = BrewSource::new("my-cask".into());
        assert_eq!(source.name(), "brew");
    }
}
