use std::path::Path;

use crate::platform::paths::get_default_config_dir;
use crate::types::{Channel, Confidence, Evidence, InstallDetection};

/// Detects installation from an install receipt file.
///
/// Looks for `{dir}/{app_name}/install-receipt.json`. If the file exists
/// and contains valid JSON, returns a Native channel detection with High confidence.
pub async fn detect_from_receipt(
    app_name: &str,
    receipt_dir: Option<&Path>,
) -> Option<InstallDetection> {
    let base_dir = match receipt_dir {
        Some(dir) => dir.to_path_buf(),
        None => get_default_config_dir(),
    };

    let receipt_path = base_dir.join(app_name).join("install-receipt.json");

    if !receipt_path.exists() {
        return None;
    }

    // Try to read and parse the file as valid JSON
    let content = match tokio::fs::read_to_string(&receipt_path).await {
        Ok(c) => c,
        Err(_) => return None,
    };

    // Validate it is valid JSON
    if serde_json::from_str::<serde_json::Value>(&content).is_err() {
        return None;
    }

    Some(InstallDetection {
        channel: Channel::Native,
        confidence: Confidence::High,
        evidence: vec![Evidence {
            source: "install-receipt".into(),
            detail: format!("found valid receipt at {}", receipt_path.display()),
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn detect_valid_receipt() {
        let tmp = TempDir::new().unwrap();
        let app_dir = tmp.path().join("my-app");
        std::fs::create_dir_all(&app_dir).unwrap();
        std::fs::write(
            app_dir.join("install-receipt.json"),
            r#"{"channel": "native", "version": "1.0.0"}"#,
        )
        .unwrap();

        let result = detect_from_receipt("my-app", Some(tmp.path())).await;
        assert!(result.is_some());
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::Native);
        assert_eq!(detection.confidence, Confidence::High);
        assert!(!detection.evidence.is_empty());
    }

    #[tokio::test]
    async fn no_receipt_returns_none() {
        let tmp = TempDir::new().unwrap();
        let result = detect_from_receipt("nonexistent-app", Some(tmp.path())).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn invalid_json_receipt_returns_none() {
        let tmp = TempDir::new().unwrap();
        let app_dir = tmp.path().join("bad-app");
        std::fs::create_dir_all(&app_dir).unwrap();
        std::fs::write(app_dir.join("install-receipt.json"), "not valid json {{{").unwrap();

        let result = detect_from_receipt("bad-app", Some(tmp.path())).await;
        assert!(result.is_none());
    }
}
