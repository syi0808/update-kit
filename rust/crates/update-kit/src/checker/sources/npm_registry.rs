use crate::errors::UpdateKitError;
use crate::utils::http::{fetch_with_timeout, FetchOptions as HttpFetchOptions};

use super::{
    FetchOptions, FetchVersionsOptions, VersionInfo, VersionListResult, VersionSource,
    VersionSourceResult,
};

/// A version source backed by the npm registry.
pub struct NpmRegistrySource {
    package_name: String,
    registry_url: String,
}

impl NpmRegistrySource {
    pub fn new(package_name: String, registry_url: Option<String>) -> Self {
        Self {
            package_name,
            registry_url: registry_url
                .unwrap_or_else(|| "https://registry.npmjs.org".to_string()),
        }
    }

    fn build_headers(&self) -> Vec<(String, String)> {
        vec![("Accept".to_string(), "application/json".to_string())]
    }
}

#[async_trait::async_trait]
impl VersionSource for NpmRegistrySource {
    fn name(&self) -> &str {
        "npm"
    }

    async fn fetch_latest(&self, _options: FetchOptions) -> VersionSourceResult {
        let url = format!("{}/{}/latest", self.registry_url, self.package_name);

        let response = match fetch_with_timeout(
            &url,
            Some(HttpFetchOptions {
                timeout_ms: None,
                headers: Some(self.build_headers()),
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

        if !response.status().is_success() {
            return VersionSourceResult::Error {
                reason: format!("npm registry returned status {}", status),
                status: Some(status),
            };
        }

        let json: serde_json::Value = match response.json().await {
            Ok(j) => j,
            Err(e) => {
                return VersionSourceResult::Error {
                    reason: format!("Failed to parse response: {}", e),
                    status: Some(status),
                }
            }
        };

        let version = match json.get("version").and_then(|v| v.as_str()) {
            Some(v) => v.to_string(),
            None => {
                return VersionSourceResult::Error {
                    reason: "Missing 'version' field in response".into(),
                    status: Some(status),
                }
            }
        };

        VersionSourceResult::Found {
            info: VersionInfo {
                version,
                release_url: None,
                release_notes: None,
                assets: None,
                published_at: None,
            },
            etag: None,
        }
    }

    async fn fetch_versions(
        &self,
        options: FetchVersionsOptions,
    ) -> Result<VersionListResult, UpdateKitError> {
        let url = format!("{}/{}", self.registry_url, self.package_name);

        let response = fetch_with_timeout(
            &url,
            Some(HttpFetchOptions {
                timeout_ms: None,
                headers: Some(self.build_headers()),
            }),
        )
        .await?;

        if !response.status().is_success() {
            return Ok(VersionListResult::Error {
                reason: format!("npm registry returned status {}", response.status().as_u16()),
            });
        }

        let json: serde_json::Value = response.json().await?;

        let versions_obj = match json.get("versions").and_then(|v| v.as_object()) {
            Some(v) => v,
            None => {
                return Ok(VersionListResult::Error {
                    reason: "Missing 'versions' object in response".into(),
                });
            }
        };

        let limit = options.limit.unwrap_or(usize::MAX);
        let versions: Vec<VersionInfo> = versions_obj
            .keys()
            .rev()
            .take(limit)
            .map(|ver| VersionInfo {
                version: ver.clone(),
                release_url: None,
                release_notes: None,
                assets: None,
                published_at: None,
            })
            .collect();

        let total_count = Some(versions_obj.len());

        Ok(VersionListResult::Success {
            versions,
            next_cursor: None,
            total_count,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_name() {
        let source = NpmRegistrySource::new("my-pkg".into(), None);
        assert_eq!(source.name(), "npm");
    }

    #[test]
    fn test_default_registry_url() {
        let source = NpmRegistrySource::new("my-pkg".into(), None);
        assert_eq!(source.registry_url, "https://registry.npmjs.org");
    }

    #[test]
    fn test_custom_registry_url() {
        let source = NpmRegistrySource::new(
            "my-pkg".into(),
            Some("https://npm.example.com".into()),
        );
        assert_eq!(source.registry_url, "https://npm.example.com");
    }
}
