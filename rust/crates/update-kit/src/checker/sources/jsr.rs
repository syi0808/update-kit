use crate::utils::http::{fetch_with_timeout, FetchOptions as HttpFetchOptions};

use super::{FetchOptions, VersionInfo, VersionSource, VersionSourceResult};

/// A version source backed by JSR (jsr.io).
pub struct JsrSource {
    scope: String,
    name: String,
    base_url: String,
}

impl JsrSource {
    pub fn new(scope: String, name: String) -> Self {
        Self {
            scope,
            name,
            base_url: "https://jsr.io".to_string(),
        }
    }

    pub fn with_base_url(scope: String, name: String, base_url: String) -> Self {
        Self {
            scope,
            name,
            base_url,
        }
    }
}

#[async_trait::async_trait]
impl VersionSource for JsrSource {
    fn name(&self) -> &str {
        "jsr"
    }

    async fn fetch_latest(&self, _options: FetchOptions) -> VersionSourceResult {
        let url = format!("{}/@{}/{}/meta.json", self.base_url, self.scope, self.name);

        let response = match fetch_with_timeout(
            &url,
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
                reason: format!("JSR returned status {}", status),
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

        // JSR meta.json has a "latest" field or we look in "versions" for the latest
        let version = json
            .get("latest")
            .and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| {
                // Fallback: find the latest from the versions object
                json.get("versions")
                    .and_then(|v| v.as_object())
                    .and_then(|obj| obj.keys().next_back().cloned())
            });

        match version {
            Some(version) => VersionSourceResult::Found {
                info: VersionInfo {
                    version,
                    release_url: Some(format!(
                        "{}/@{}/{}",
                        self.base_url, self.scope, self.name
                    )),
                    release_notes: None,
                    assets: None,
                    published_at: None,
                },
                etag: None,
            },
            None => VersionSourceResult::Error {
                reason: "Could not determine latest version from JSR meta.json".into(),
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
        let source = JsrSource::new("scope".into(), "pkg".into());
        assert_eq!(source.name(), "jsr");
    }

    #[test]
    fn default_base_url() {
        let source = JsrSource::new("scope".into(), "pkg".into());
        assert_eq!(source.base_url, "https://jsr.io");
    }

    #[test]
    fn custom_base_url() {
        let source = JsrSource::with_base_url(
            "scope".into(),
            "pkg".into(),
            "https://custom.jsr.io".into(),
        );
        assert_eq!(source.base_url, "https://custom.jsr.io");
    }

    #[tokio::test]
    async fn fetch_latest_unreachable_returns_error() {
        let source = JsrSource::with_base_url(
            "scope".into(),
            "pkg".into(),
            "https://localhost:1".into(),
        );
        let result = source.fetch_latest(FetchOptions::default()).await;
        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(!reason.is_empty());
            }
            other => panic!("Expected Error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_latest_http_rejected() {
        let source = JsrSource::with_base_url(
            "scope".into(),
            "pkg".into(),
            "http://insecure.com".into(),
        );
        let result = source.fetch_latest(FetchOptions::default()).await;
        match result {
            VersionSourceResult::Error { reason, .. } => {
                assert!(
                    reason.contains("HTTPS") || reason.contains("Insecure"),
                    "Expected HTTPS/Insecure error, got: {reason}"
                );
            }
            other => panic!("Expected Error for HTTP, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_versions_returns_unsupported() {
        let source = JsrSource::new("scope".into(), "pkg".into());
        let result = source
            .fetch_versions(super::super::FetchVersionsOptions::default())
            .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code(), "UNSUPPORTED_OPERATION");
    }

    #[test]
    fn source_name_is_jsr() {
        let source = JsrSource::with_base_url("s".into(), "n".into(), "https://x.com".into());
        assert_eq!(source.name(), "jsr");
    }

    #[test]
    fn scope_and_name_stored() {
        let source = JsrSource::new("my-scope".into(), "my-pkg".into());
        assert_eq!(source.scope, "my-scope");
        assert_eq!(source.name, "my-pkg");
    }
}
