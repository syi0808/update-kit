use crate::errors::UpdateKitError;
use crate::types::AssetInfo;
use crate::utils::http::{fetch_with_timeout, FetchOptions as HttpFetchOptions};

use super::{
    FetchOptions, FetchVersionsOptions, VersionInfo, VersionListResult, VersionSource,
    VersionSourceResult,
};

/// A version source backed by GitHub Releases.
pub struct GitHubReleasesSource {
    owner: String,
    repo: String,
    token: Option<String>,
    api_base_url: String,
}

impl GitHubReleasesSource {
    pub fn new(
        owner: String,
        repo: String,
        token: Option<String>,
        api_base_url: Option<String>,
    ) -> Self {
        Self {
            owner,
            repo,
            token,
            api_base_url: api_base_url
                .unwrap_or_else(|| "https://api.github.com".to_string()),
        }
    }

    fn build_headers(&self, etag: Option<&str>) -> Vec<(String, String)> {
        let mut headers = vec![
            (
                "Accept".to_string(),
                "application/vnd.github+json".to_string(),
            ),
            ("User-Agent".to_string(), "update-kit".to_string()),
        ];
        if let Some(token) = &self.token {
            headers.push(("Authorization".to_string(), format!("Bearer {}", token)));
        }
        if let Some(etag) = etag {
            headers.push(("If-None-Match".to_string(), etag.to_string()));
        }
        headers
    }

    fn parse_release(&self, json: &serde_json::Value) -> Option<VersionInfo> {
        let tag = json.get("tag_name")?.as_str()?;
        let version = tag.strip_prefix('v').unwrap_or(tag).to_string();

        let release_url = json
            .get("html_url")
            .and_then(|v| v.as_str())
            .map(String::from);

        let release_notes = json.get("body").and_then(|v| v.as_str()).map(String::from);

        let published_at = json
            .get("published_at")
            .and_then(|v| v.as_str())
            .map(String::from);

        let assets = json.get("assets").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let name = a.get("name")?.as_str()?.to_string();
                    let url = a
                        .get("browser_download_url")?
                        .as_str()?
                        .to_string();
                    let size = a.get("size").and_then(|v| v.as_u64());
                    Some(AssetInfo {
                        name,
                        url,
                        size,
                        checksum_url: None,
                    })
                })
                .collect()
        });

        Some(VersionInfo {
            version,
            release_url,
            release_notes,
            assets,
            published_at,
        })
    }
}

#[async_trait::async_trait]
impl VersionSource for GitHubReleasesSource {
    fn name(&self) -> &str {
        "github"
    }

    async fn fetch_latest(&self, options: FetchOptions) -> VersionSourceResult {
        let url = format!(
            "{}/repos/{}/{}/releases/latest",
            self.api_base_url, self.owner, self.repo
        );

        let headers = self.build_headers(options.etag.as_deref());

        let response = match fetch_with_timeout(
            &url,
            Some(HttpFetchOptions {
                timeout_ms: None,
                headers: Some(headers),
            }),
        )
        .await
        {
            Ok(r) => r,
            Err(e) => {
                return VersionSourceResult::Error {
                    reason: e.to_string(),
                    status: None,
                }
            }
        };

        let status = response.status().as_u16();

        if status == 304 {
            if let Some(etag) = options.etag {
                return VersionSourceResult::NotModified { etag };
            }
        }

        if !response.status().is_success() {
            return VersionSourceResult::Error {
                reason: format!("GitHub API returned status {}", status),
                status: Some(status),
            };
        }

        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let json: serde_json::Value = match response.json().await {
            Ok(j) => j,
            Err(e) => {
                return VersionSourceResult::Error {
                    reason: format!("Failed to parse response: {}", e),
                    status: Some(status),
                }
            }
        };

        match self.parse_release(&json) {
            Some(info) => VersionSourceResult::Found { info, etag },
            None => VersionSourceResult::Error {
                reason: "Failed to parse release data".into(),
                status: Some(status),
            },
        }
    }

    async fn fetch_versions(
        &self,
        options: FetchVersionsOptions,
    ) -> Result<VersionListResult, UpdateKitError> {
        let per_page = options.limit.unwrap_or(30).min(100);
        let page = options
            .cursor
            .as_deref()
            .and_then(|c| c.parse::<u32>().ok())
            .unwrap_or(1);

        let url = format!(
            "{}/repos/{}/{}/releases?per_page={}&page={}",
            self.api_base_url, self.owner, self.repo, per_page, page
        );

        let headers = self.build_headers(None);

        let response = fetch_with_timeout(
            &url,
            Some(HttpFetchOptions {
                timeout_ms: None,
                headers: Some(headers),
            }),
        )
        .await?;

        if !response.status().is_success() {
            return Ok(VersionListResult::Error {
                reason: format!("GitHub API returned status {}", response.status().as_u16()),
            });
        }

        let json: serde_json::Value = response.json().await?;

        let versions = json
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|release| self.parse_release(release))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let has_more = versions.len() == per_page;
        let next_cursor = if has_more {
            Some((page + 1).to_string())
        } else {
            None
        };

        Ok(VersionListResult::Success {
            versions,
            next_cursor,
            total_count: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_name() {
        let source = GitHubReleasesSource::new(
            "owner".into(),
            "repo".into(),
            None,
            None,
        );
        assert_eq!(source.name(), "github");
    }

    #[test]
    fn test_custom_api_base_url() {
        let source = GitHubReleasesSource::new(
            "owner".into(),
            "repo".into(),
            None,
            Some("https://github.example.com/api/v3".into()),
        );
        assert_eq!(source.api_base_url, "https://github.example.com/api/v3");
    }

    #[test]
    fn test_parse_release() {
        let source = GitHubReleasesSource::new(
            "owner".into(),
            "repo".into(),
            None,
            None,
        );
        let json = serde_json::json!({
            "tag_name": "v1.2.3",
            "html_url": "https://github.com/owner/repo/releases/tag/v1.2.3",
            "body": "Release notes",
            "published_at": "2024-01-01T00:00:00Z",
            "assets": [
                {
                    "name": "app-linux-x64.tar.gz",
                    "browser_download_url": "https://github.com/owner/repo/releases/download/v1.2.3/app-linux-x64.tar.gz",
                    "size": 1024
                }
            ]
        });

        let info = source.parse_release(&json).unwrap();
        assert_eq!(info.version, "1.2.3");
        assert_eq!(
            info.release_url,
            Some("https://github.com/owner/repo/releases/tag/v1.2.3".into())
        );
        assert_eq!(info.release_notes, Some("Release notes".into()));
        assert_eq!(info.assets.as_ref().unwrap().len(), 1);
        assert_eq!(info.assets.as_ref().unwrap()[0].name, "app-linux-x64.tar.gz");
    }

    #[test]
    fn test_parse_release_without_v_prefix() {
        let source = GitHubReleasesSource::new(
            "owner".into(),
            "repo".into(),
            None,
            None,
        );
        let json = serde_json::json!({
            "tag_name": "1.0.0",
            "html_url": "https://github.com/owner/repo/releases/tag/1.0.0"
        });

        let info = source.parse_release(&json).unwrap();
        assert_eq!(info.version, "1.0.0");
    }
}
