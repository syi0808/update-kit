use crate::constants::DEFAULT_FETCH_TIMEOUT_MS;
use crate::errors::UpdateKitError;
use crate::utils::security::require_https;
use std::time::Duration;

/// Options for HTTP fetch operations.
#[derive(Debug, Default, Clone)]
pub struct FetchOptions {
    /// Request timeout in milliseconds. Defaults to `DEFAULT_FETCH_TIMEOUT_MS`.
    pub timeout_ms: Option<u64>,
    /// Additional HTTP headers as `(name, value)` pairs.
    pub headers: Option<Vec<(String, String)>>,
}

/// Performs an HTTP GET request with HTTPS enforcement and configurable timeout.
///
/// Validates that the URL uses HTTPS, then sends a GET request using `reqwest`
/// with the specified (or default) timeout and optional custom headers.
pub async fn fetch_with_timeout(
    url: &str,
    options: Option<FetchOptions>,
) -> Result<reqwest::Response, UpdateKitError> {
    require_https(url)?;

    let opts = options.unwrap_or_default();
    let timeout = Duration::from_millis(opts.timeout_ms.unwrap_or(DEFAULT_FETCH_TIMEOUT_MS));

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(UpdateKitError::NetworkError)?;

    let mut request = client.get(url);

    if let Some(headers) = opts.headers {
        for (name, value) in headers {
            request = request.header(name, value);
        }
    }

    let response = request.send().await?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fetch_rejects_http() {
        let result = fetch_with_timeout("http://example.com", None).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, UpdateKitError::InsecureUrl(_)),
            "Expected InsecureUrl, got: {err:?}"
        );
    }

    #[test]
    fn fetch_options_default() {
        let opts = FetchOptions::default();
        assert!(opts.timeout_ms.is_none());
        assert!(opts.headers.is_none());
    }

    #[tokio::test]
    async fn fetch_rejects_ftp() {
        let result = fetch_with_timeout("ftp://example.com", None).await;
        assert!(matches!(
            result.unwrap_err(),
            UpdateKitError::InsecureUrl(_)
        ));
    }

    #[tokio::test]
    async fn fetch_rejects_empty_url() {
        let result = fetch_with_timeout("", None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn fetch_rejects_file_scheme() {
        let result = fetch_with_timeout("file:///etc/passwd", None).await;
        assert!(matches!(
            result.unwrap_err(),
            UpdateKitError::InsecureUrl(_)
        ));
    }

    #[tokio::test]
    async fn fetch_with_custom_timeout_connection_refused() {
        let opts = FetchOptions {
            timeout_ms: Some(100),
            headers: None,
        };
        // Use unreachable HTTPS address - should fail with network error
        let result = fetch_with_timeout("https://127.0.0.1:1/nonexistent", Some(opts)).await;
        assert!(result.is_err());
        // Should be a NetworkError, not InsecureUrl
        assert!(!matches!(
            result.unwrap_err(),
            UpdateKitError::InsecureUrl(_)
        ));
    }

    #[tokio::test]
    async fn fetch_with_custom_headers_connection_refused() {
        let opts = FetchOptions {
            timeout_ms: Some(100),
            headers: Some(vec![
                ("X-Custom".into(), "value".into()),
                ("Authorization".into(), "Bearer test".into()),
            ]),
        };
        let result = fetch_with_timeout("https://127.0.0.1:1/nonexistent", Some(opts)).await;
        assert!(result.is_err());
    }

    #[test]
    fn fetch_options_with_all_fields() {
        let opts = FetchOptions {
            timeout_ms: Some(5000),
            headers: Some(vec![("Accept".into(), "application/json".into())]),
        };
        assert_eq!(opts.timeout_ms, Some(5000));
        assert_eq!(opts.headers.as_ref().unwrap().len(), 1);
        assert_eq!(opts.headers.as_ref().unwrap()[0].0, "Accept");
    }
}
