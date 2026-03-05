use crate::utils::http::{fetch_with_timeout, FetchOptions as HttpFetchOptions};

use super::{FetchOptions, VersionInfo, VersionSource, VersionSourceResult};

/// A version source backed by JSR (jsr.io).
pub struct JsrSource {
    scope: String,
    name: String,
}

impl JsrSource {
    pub fn new(scope: String, name: String) -> Self {
        Self { scope, name }
    }
}

#[async_trait::async_trait]
impl VersionSource for JsrSource {
    fn name(&self) -> &str {
        "jsr"
    }

    async fn fetch_latest(&self, _options: FetchOptions) -> VersionSourceResult {
        let url = format!("https://jsr.io/@{}/{}/meta.json", self.scope, self.name);

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
                    .and_then(|obj| obj.keys().last().cloned())
            });

        match version {
            Some(version) => VersionSourceResult::Found {
                info: VersionInfo {
                    version,
                    release_url: Some(format!(
                        "https://jsr.io/@{}/{}",
                        self.scope, self.name
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
}
