use super::{FetchOptions, VersionInfo, VersionSource, VersionSourceResult};

/// A version source backed by Homebrew (brew info --json).
pub struct BrewSource {
    cask_name: String,
}

impl BrewSource {
    pub fn new(cask_name: String) -> Self {
        Self { cask_name }
    }
}

#[async_trait::async_trait]
impl VersionSource for BrewSource {
    fn name(&self) -> &str {
        "brew"
    }

    async fn fetch_latest(&self, _options: FetchOptions) -> VersionSourceResult {
        let output = match std::process::Command::new("brew")
            .args(["info", "--json=v2", "--cask", &self.cask_name])
            .output()
        {
            Ok(o) => o,
            Err(e) => {
                return VersionSourceResult::Error {
                    reason: format!("Failed to run brew: {}", e),
                    status: None,
                }
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return VersionSourceResult::Error {
                reason: format!("brew info failed: {}", stderr.trim()),
                status: None,
            };
        }

        let json: serde_json::Value = match serde_json::from_slice(&output.stdout) {
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
