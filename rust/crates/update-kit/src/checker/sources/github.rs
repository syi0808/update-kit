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

    #[test]
    fn parse_release_no_assets() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let json = serde_json::json!({
            "tag_name": "v1.0.0",
            "html_url": "https://github.com/owner/repo/releases/tag/v1.0.0",
            "body": "Notes",
            "published_at": "2024-01-01T00:00:00Z"
        });

        let info = source.parse_release(&json).unwrap();
        assert_eq!(info.version, "1.0.0");
        assert!(info.assets.is_none());
    }

    #[test]
    fn parse_release_no_body() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let json = serde_json::json!({
            "tag_name": "v1.0.0",
            "html_url": "https://github.com/owner/repo/releases/tag/v1.0.0"
        });

        let info = source.parse_release(&json).unwrap();
        assert_eq!(info.version, "1.0.0");
        assert!(info.release_notes.is_none());
    }

    #[test]
    fn parse_release_no_html_url() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let json = serde_json::json!({
            "tag_name": "v2.0.0",
            "body": "Some notes"
        });

        let info = source.parse_release(&json).unwrap();
        assert_eq!(info.version, "2.0.0");
        assert!(info.release_url.is_none());
        assert_eq!(info.release_notes, Some("Some notes".into()));
    }

    #[test]
    fn parse_release_minimal() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let json = serde_json::json!({
            "tag_name": "v0.1.0"
        });

        let info = source.parse_release(&json).unwrap();
        assert_eq!(info.version, "0.1.0");
        assert!(info.release_url.is_none());
        assert!(info.release_notes.is_none());
        assert!(info.assets.is_none());
        assert!(info.published_at.is_none());
    }

    #[test]
    fn parse_release_empty_assets() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let json = serde_json::json!({
            "tag_name": "v1.0.0",
            "assets": []
        });

        let info = source.parse_release(&json).unwrap();
        assert_eq!(info.version, "1.0.0");
        let assets = info.assets.unwrap();
        assert!(assets.is_empty());
    }

    #[test]
    fn parse_release_asset_missing_fields() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let json = serde_json::json!({
            "tag_name": "v1.0.0",
            "assets": [
                {
                    "name": "app.tar.gz",
                    "browser_download_url": "https://example.com/download",
                    "size": 2048
                },
                {
                    "name": "incomplete-asset"
                    // missing browser_download_url — should be filtered out
                },
                {
                    "browser_download_url": "https://example.com/other"
                    // missing name — should be filtered out
                }
            ]
        });

        let info = source.parse_release(&json).unwrap();
        let assets = info.assets.unwrap();
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].name, "app.tar.gz");
        assert_eq!(assets[0].url, "https://example.com/download");
        assert_eq!(assets[0].size, Some(2048));
    }

    #[test]
    fn parse_release_missing_tag_name_returns_none() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let json = serde_json::json!({
            "html_url": "https://github.com/owner/repo/releases/tag/v1.0.0",
            "body": "Notes"
        });

        assert!(source.parse_release(&json).is_none());
    }

    #[test]
    fn build_headers_without_token() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let headers = source.build_headers(None);

        assert_eq!(headers.len(), 2);
        assert!(headers.iter().any(|(k, v)| k == "Accept" && v == "application/vnd.github+json"));
        assert!(headers.iter().any(|(k, v)| k == "User-Agent" && v == "update-kit"));
        assert!(!headers.iter().any(|(k, _)| k == "Authorization"));
        assert!(!headers.iter().any(|(k, _)| k == "If-None-Match"));
    }

    #[test]
    fn build_headers_with_token() {
        let source = GitHubReleasesSource::new(
            "owner".into(),
            "repo".into(),
            Some("test-token".into()),
            None,
        );
        let headers = source.build_headers(None);

        assert_eq!(headers.len(), 3);
        assert!(headers.iter().any(|(k, v)| k == "Authorization" && v == "Bearer test-token"));
    }

    #[test]
    fn build_headers_with_etag() {
        let source = GitHubReleasesSource::new("owner".into(), "repo".into(), None, None);
        let headers = source.build_headers(Some("\"etag-value\""));

        assert_eq!(headers.len(), 3);
        assert!(headers.iter().any(|(k, v)| k == "If-None-Match" && v == "\"etag-value\""));
    }

    #[test]
    fn build_headers_with_token_and_etag() {
        let source = GitHubReleasesSource::new(
            "owner".into(),
            "repo".into(),
            Some("my-token".into()),
            None,
        );
        let headers = source.build_headers(Some("\"abc\""));

        assert_eq!(headers.len(), 4);
        assert!(headers.iter().any(|(k, v)| k == "Authorization" && v == "Bearer my-token"));
        assert!(headers.iter().any(|(k, v)| k == "If-None-Match" && v == "\"abc\""));
    }

    #[tokio::test]
    async fn fetch_latest_unreachable_returns_error() {
        // Uses an unreachable HTTPS URL to test the error path without needing mockito.
        // fetch_with_timeout enforces HTTPS, so we use an HTTPS URL that won't connect.
        let source = GitHubReleasesSource::new(
            "owner".into(),
            "repo".into(),
            None,
            Some("https://localhost:1".into()),
        );
        let result = source.fetch_latest(FetchOptions::default()).await;

        match result {
            VersionSourceResult::Error { reason, status } => {
                assert!(!reason.is_empty());
                assert!(status.is_none());
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_versions_unreachable_returns_error() {
        let source = GitHubReleasesSource::new(
            "owner".into(),
            "repo".into(),
            None,
            Some("https://localhost:1".into()),
        );
        let result = source
            .fetch_versions(FetchVersionsOptions {
                limit: None,
                cursor: None,
            })
            .await;

        assert!(result.is_err());
    }
}
