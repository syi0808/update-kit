use crate::utils::http::{fetch_with_timeout, FetchOptions as HttpFetchOptions};

use super::{FetchOptions, VersionInfo, VersionSource, VersionSourceResult};

/// A version source backed by a custom JSON manifest URL.
pub struct CustomManifestSource {
    url: String,
    version_field: String,
}

impl CustomManifestSource {
    pub fn new(url: String, version_field: Option<String>) -> Self {
        Self {
            url,
            version_field: version_field.unwrap_or_else(|| "version".to_string()),
        }
    }

    /// Extract a value from a JSON object using dot-notation field path.
    /// E.g., "data.latest.version" navigates json["data"]["latest"]["version"].
    fn extract_field<'a>(json: &'a serde_json::Value, field_path: &str) -> Option<&'a str> {
        let mut current = json;
        for part in field_path.split('.') {
            current = current.get(part)?;
        }
        current.as_str()
    }
}

#[async_trait::async_trait]
impl VersionSource for CustomManifestSource {
    fn name(&self) -> &str {
        "custom"
    }

    async fn fetch_latest(&self, _options: FetchOptions) -> VersionSourceResult {
        let response = match fetch_with_timeout(
            &self.url,
            Some(HttpFetchOptions {
                timeout_ms: None,
                headers: None,
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
                reason: format!("Custom manifest returned status {}", status),
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

        match Self::extract_field(&json, &self.version_field) {
            Some(version) => VersionSourceResult::Found {
                info: VersionInfo {
                    version: version.to_string(),
                    release_url: None,
                    release_notes: None,
                    assets: None,
                    published_at: None,
                },
                etag: None,
            },
            None => VersionSourceResult::Error {
                reason: format!(
                    "Field '{}' not found in manifest response",
                    self.version_field
                ),
                status: Some(status),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_source_name() {
        let source = CustomManifestSource::new(
            "https://example.com/version.json".into(),
            None,
        );
        assert_eq!(source.name(), "custom");
    }

    #[test]
    fn test_default_version_field() {
        let source = CustomManifestSource::new(
            "https://example.com/version.json".into(),
            None,
        );
        assert_eq!(source.version_field, "version");
    }

    #[test]
    fn test_extract_field_simple() {
        let json = serde_json::json!({"version": "1.2.3"});
        assert_eq!(
            CustomManifestSource::extract_field(&json, "version"),
            Some("1.2.3")
        );
    }

    #[test]
    fn test_extract_field_nested() {
        let json = serde_json::json!({
            "data": {
                "latest": {
                    "version": "2.0.0"
                }
            }
        });
        assert_eq!(
            CustomManifestSource::extract_field(&json, "data.latest.version"),
            Some("2.0.0")
        );
    }

    #[test]
    fn test_extract_field_missing() {
        let json = serde_json::json!({"name": "app"});
        assert_eq!(
            CustomManifestSource::extract_field(&json, "version"),
            None
        );
    }

    #[test]
    fn custom_version_field() {
        let source = CustomManifestSource::new(
            "https://example.com/v.json".into(),
            Some("data.version".into()),
        );
        assert_eq!(source.version_field, "data.version");
    }

    #[test]
    fn extract_field_deeply_nested() {
        let json = serde_json::json!({"a": {"b": {"c": {"d": "1.0.0"}}}});
        assert_eq!(
            CustomManifestSource::extract_field(&json, "a.b.c.d"),
            Some("1.0.0")
        );
    }

    #[test]
    fn extract_field_non_string_value() {
        let json = serde_json::json!({"version": 123});
        assert_eq!(
            CustomManifestSource::extract_field(&json, "version"),
            None
        );
    }

    #[test]
    fn extract_field_null_value() {
        let json = serde_json::json!({"version": null});
        assert_eq!(
            CustomManifestSource::extract_field(&json, "version"),
            None
        );
    }

    #[test]
    fn extract_field_array_value() {
        let json = serde_json::json!({"version": ["1.0.0"]});
        assert_eq!(
            CustomManifestSource::extract_field(&json, "version"),
            None
        );
    }

    #[tokio::test]
    async fn fetch_latest_http_url_rejected() {
        let source =
            CustomManifestSource::new("http://insecure.com/version.json".into(), None);
        let result = source.fetch_latest(FetchOptions::default()).await;
        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(reason.contains("HTTPS") || reason.contains("Insecure"));
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_latest_unreachable_returns_error() {
        let source =
            CustomManifestSource::new("https://localhost:1/version.json".into(), None);
        let result = source.fetch_latest(FetchOptions::default()).await;
        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(!reason.is_empty());
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_versions_returns_unsupported() {
        let source =
            CustomManifestSource::new("https://example.com/v.json".into(), None);
        let result = source
            .fetch_versions(super::super::FetchVersionsOptions::default())
            .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code(), "UNSUPPORTED_OPERATION");
    }
}
