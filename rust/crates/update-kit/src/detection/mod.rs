pub mod brew;
pub mod heuristics;
pub mod npm;
pub mod receipt;

use std::path::Path;

use crate::config::CustomDetector;
use crate::types::{Channel, Confidence, Evidence, InstallDetection};
use crate::utils::process::CommandRunner;

pub use brew::detect_from_brew;
pub use heuristics::collect_path_heuristics;
pub use npm::detect_from_npm;
pub use receipt::detect_from_receipt;

/// Configuration for the detection pipeline.
pub struct DetectionConfig<'a> {
    /// The application name (used for receipt lookup).
    pub app_name: &'a str,
    /// Optional Homebrew cask name for brew verification.
    pub brew_cask_name: Option<&'a str>,
    /// Custom detectors to run before built-in detection.
    pub custom_detectors: &'a [CustomDetector],
    /// Optional override for the receipt directory (defaults to platform config dir).
    pub receipt_dir: Option<&'a Path>,
}

/// Main orchestrator for install detection.
///
/// Detection priority:
/// 1. Custom detectors (iterate, first non-None result wins)
/// 2. Install receipt (check for config_dir/{app_name}/install-receipt.json)
/// 3. Homebrew (check path patterns + optional `brew list --cask` verification)
/// 4. npm global (check path patterns + optional `npm prefix -g` verification)
/// 5. Fallback: unmanaged with heuristic evidence
pub async fn detect_install(
    exec_path: &str,
    config: &DetectionConfig<'_>,
    cmd: &dyn CommandRunner,
) -> InstallDetection {
    // 1. Custom detectors
    for detector in config.custom_detectors {
        match (detector.detect)().await {
            Ok(Some(detection)) => return detection,
            Ok(None) => continue,
            Err(_) => continue,
        }
    }

    // 2. Install receipt
    if let Some(detection) = detect_from_receipt(config.app_name, config.receipt_dir).await {
        return detection;
    }

    // 3. Homebrew
    if let Some(detection) = detect_from_brew(exec_path, config.brew_cask_name, cmd).await {
        return detection;
    }

    // 4. npm global
    if let Some(detection) = detect_from_npm(exec_path, cmd).await {
        return detection;
    }

    // 5. Fallback: unmanaged with heuristic evidence
    let evidence = collect_path_heuristics(exec_path);
    let mut all_evidence = vec![Evidence {
        source: "fallback".into(),
        detail: "no known install channel detected".into(),
    }];
    all_evidence.extend(evidence);

    InstallDetection {
        channel: Channel::Unmanaged,
        confidence: Confidence::Low,
        evidence: all_evidence,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::MockCommandRunner;
    use crate::utils::process::TokioCommandRunner;

    #[tokio::test]
    async fn fallback_to_unmanaged() {
        let cmd = TokioCommandRunner;
        let config = DetectionConfig {
            app_name: "nonexistent-test-app",
            brew_cask_name: None,
            custom_detectors: &[],
            receipt_dir: None,
        };

        let detection = detect_install("/tmp/random/path/my-app", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::Unmanaged);
        assert_eq!(detection.confidence, Confidence::Low);
        assert!(!detection.evidence.is_empty());
    }

    #[tokio::test]
    async fn custom_detector_takes_priority() {
        let detector = CustomDetector {
            name: "test-detector".into(),
            detect: Box::new(|| {
                Box::pin(async {
                    Ok(Some(InstallDetection {
                        channel: Channel::Custom("test-channel".into()),
                        confidence: Confidence::High,
                        evidence: vec![Evidence {
                            source: "test".into(),
                            detail: "custom detection".into(),
                        }],
                    }))
                })
            }),
        };

        let detectors = vec![detector];
        let config = DetectionConfig {
            app_name: "test-app",
            brew_cask_name: None,
            custom_detectors: &detectors,
            receipt_dir: None,
        };

        let cmd = TokioCommandRunner;
        let detection = detect_install("/tmp/random/path", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::Custom("test-channel".into()));
        assert_eq!(detection.confidence, Confidence::High);
    }

    #[tokio::test]
    async fn receipt_detection_before_path_heuristics() {
        let tmp = tempfile::TempDir::new().unwrap();
        let app_dir = tmp.path().join("my-app");
        std::fs::create_dir_all(&app_dir).unwrap();
        std::fs::write(
            app_dir.join("install-receipt.json"),
            r#"{"channel": "native"}"#,
        )
        .unwrap();

        // Use a brew-like path, but receipt should win
        let config = DetectionConfig {
            app_name: "my-app",
            brew_cask_name: None,
            custom_detectors: &[],
            receipt_dir: Some(tmp.path()),
        };

        let cmd = TokioCommandRunner;
        let detection = detect_install("/opt/homebrew/bin/my-app", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::Native);
        assert_eq!(detection.confidence, Confidence::High);
    }

    #[tokio::test]
    async fn brew_path_detected_without_receipt() {
        let cmd = TokioCommandRunner;
        let tmp = tempfile::TempDir::new().unwrap();

        let config = DetectionConfig {
            app_name: "nonexistent-app",
            brew_cask_name: None,
            custom_detectors: &[],
            receipt_dir: Some(tmp.path()),
        };

        let detection = detect_install("/opt/homebrew/bin/my-app", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::BrewCask);
    }

    #[tokio::test]
    async fn npm_path_detected_without_receipt() {
        let cmd = TokioCommandRunner;
        let tmp = tempfile::TempDir::new().unwrap();

        let config = DetectionConfig {
            app_name: "nonexistent-app",
            brew_cask_name: None,
            custom_detectors: &[],
            receipt_dir: Some(tmp.path()),
        };

        let detection =
            detect_install("/usr/local/lib/node_modules/.bin/my-app", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::NpmGlobal);
    }

    #[tokio::test]
    async fn failing_custom_detector_skipped() {
        let detector = CustomDetector {
            name: "failing-detector".into(),
            detect: Box::new(|| {
                Box::pin(async {
                    Err(crate::errors::UpdateKitError::DetectionFailed(
                        "intentional failure".into(),
                    ))
                })
            }),
        };

        let detectors = vec![detector];
        let config = DetectionConfig {
            app_name: "nonexistent-app",
            brew_cask_name: None,
            custom_detectors: &detectors,
            receipt_dir: None,
        };

        let cmd = TokioCommandRunner;
        let detection = detect_install("/tmp/random/path", &config, &cmd).await;
        // Should fall through to unmanaged since custom detector errored
        assert_eq!(detection.channel, Channel::Unmanaged);
    }

    // ── Orchestration tests using MockCommandRunner ──

    #[tokio::test]
    async fn custom_detector_returning_none_continues_pipeline() {
        let skip_detector = CustomDetector {
            name: "skip".into(),
            detect: Box::new(|| Box::pin(async { Ok(None) })),
        };
        let detectors = vec![skip_detector];
        let tmp = tempfile::TempDir::new().unwrap();
        let cmd = MockCommandRunner::new();
        let config = DetectionConfig {
            app_name: "test-app",
            brew_cask_name: None,
            custom_detectors: &detectors,
            receipt_dir: Some(tmp.path()),
        };
        // Should fall through to unmanaged since skip detector returns None and no brew/npm path
        let detection = detect_install("/tmp/random/path", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::Unmanaged);
    }

    #[tokio::test]
    async fn multiple_custom_detectors_first_match_wins() {
        let first = CustomDetector {
            name: "first".into(),
            detect: Box::new(|| {
                Box::pin(async {
                    Ok(Some(InstallDetection {
                        channel: Channel::Custom("first-channel".into()),
                        confidence: Confidence::High,
                        evidence: vec![Evidence {
                            source: "first".into(),
                            detail: "first wins".into(),
                        }],
                    }))
                })
            }),
        };
        let second = CustomDetector {
            name: "second".into(),
            detect: Box::new(|| {
                Box::pin(async {
                    Ok(Some(InstallDetection {
                        channel: Channel::Custom("second-channel".into()),
                        confidence: Confidence::High,
                        evidence: vec![],
                    }))
                })
            }),
        };
        let detectors = vec![first, second];
        let cmd = MockCommandRunner::new();
        let config = DetectionConfig {
            app_name: "test-app",
            brew_cask_name: None,
            custom_detectors: &detectors,
            receipt_dir: None,
        };
        let detection = detect_install("/tmp/path", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::Custom("first-channel".into()));
    }

    #[tokio::test]
    async fn brew_verified_before_npm() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew list --cask my-cask",
            Ok(MockCommandRunner::success_output("")),
        );
        let tmp = tempfile::TempDir::new().unwrap();
        let config = DetectionConfig {
            app_name: "test-app",
            brew_cask_name: Some("my-cask"),
            custom_detectors: &[],
            receipt_dir: Some(tmp.path()),
        };
        let detection = detect_install("/opt/homebrew/bin/my-app", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::BrewCask);
    }

    #[tokio::test]
    async fn fallback_unmanaged_has_fallback_evidence() {
        let cmd = MockCommandRunner::new();
        let tmp = tempfile::TempDir::new().unwrap();
        let config = DetectionConfig {
            app_name: "test-app",
            brew_cask_name: None,
            custom_detectors: &[],
            receipt_dir: Some(tmp.path()),
        };
        let detection = detect_install("/usr/local/bin/random-app", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::Unmanaged);
        assert_eq!(detection.confidence, Confidence::Low);
        assert!(detection.evidence.iter().any(|e| e.source == "fallback"));
    }

    #[tokio::test]
    async fn receipt_with_custom_dir_wins_over_brew_path() {
        let tmp = tempfile::TempDir::new().unwrap();
        let app_dir = tmp.path().join("my-app");
        std::fs::create_dir_all(&app_dir).unwrap();
        std::fs::write(
            app_dir.join("install-receipt.json"),
            r#"{"channel":"native"}"#,
        )
        .unwrap();

        let cmd = MockCommandRunner::new();
        let config = DetectionConfig {
            app_name: "my-app",
            brew_cask_name: None,
            custom_detectors: &[],
            receipt_dir: Some(tmp.path()),
        };
        // Brew path but receipt exists — receipt wins
        let detection = detect_install("/opt/homebrew/bin/my-app", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::Native);
        assert_eq!(detection.confidence, Confidence::High);
    }

    #[tokio::test]
    async fn npm_path_detected_when_no_receipt_or_brew() {
        let tmp = tempfile::TempDir::new().unwrap();
        let cmd = MockCommandRunner::new();
        let config = DetectionConfig {
            app_name: "test-app",
            brew_cask_name: None,
            custom_detectors: &[],
            receipt_dir: Some(tmp.path()),
        };
        let detection =
            detect_install("/usr/local/lib/node_modules/.bin/my-app", &config, &cmd).await;
        assert_eq!(detection.channel, Channel::NpmGlobal);
    }
}
