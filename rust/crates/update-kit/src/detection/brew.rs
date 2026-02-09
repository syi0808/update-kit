use crate::types::{Channel, Confidence, Evidence, InstallDetection};
use crate::utils::process::CommandRunner;

/// Path patterns that indicate a Homebrew installation.
const BREW_PATH_PATTERNS: &[&str] = &[
    "/opt/homebrew/",
    "/usr/local/Caskroom/",
    "/usr/local/Cellar/",
    "/home/linuxbrew/",
];

/// Detects installation via Homebrew by checking path patterns and optionally
/// verifying with `brew list --cask`.
///
/// If the executable path contains a brew pattern, detection is triggered.
/// If `brew_cask_name` is provided, `brew list --cask {name}` is run for
/// verification, yielding High confidence on success. Otherwise, Medium
/// confidence is returned.
pub async fn detect_from_brew(
    exec_path: &str,
    brew_cask_name: Option<&str>,
    cmd: &dyn CommandRunner,
) -> Option<InstallDetection> {
    let matching_pattern = BREW_PATH_PATTERNS
        .iter()
        .find(|pattern| exec_path.contains(*pattern));

    let pattern = matching_pattern?;
    let mut evidence = vec![Evidence {
        source: "brew-path".into(),
        detail: format!("path contains brew pattern '{}'", pattern),
    }];

    // If a cask name is provided, try to verify with brew
    if let Some(cask_name) = brew_cask_name {
        match cmd.run("brew", &["list", "--cask", cask_name]).await {
            Ok(output) if output.success() => {
                evidence.push(Evidence {
                    source: "brew-verify".into(),
                    detail: format!("brew list --cask {} succeeded", cask_name),
                });
                return Some(InstallDetection {
                    channel: Channel::BrewCask,
                    confidence: Confidence::High,
                    evidence,
                });
            }
            _ => {
                // Verification failed but path still matched, use Medium
            }
        }
    }

    Some(InstallDetection {
        channel: Channel::BrewCask,
        confidence: Confidence::Medium,
        evidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::process::TokioCommandRunner;

    #[tokio::test]
    async fn brew_path_detected_without_cask_name() {
        let cmd = TokioCommandRunner;
        let result = detect_from_brew("/opt/homebrew/bin/my-app", None, &cmd).await;
        assert!(result.is_some());
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::BrewCask);
        assert_eq!(detection.confidence, Confidence::Medium);
    }

    #[tokio::test]
    async fn non_brew_path_returns_none() {
        let cmd = TokioCommandRunner;
        let result = detect_from_brew("/usr/bin/my-app", None, &cmd).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn cellar_path_detected() {
        let cmd = TokioCommandRunner;
        let result =
            detect_from_brew("/usr/local/Cellar/my-app/1.0/bin/my-app", None, &cmd).await;
        assert!(result.is_some());
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::BrewCask);
    }

    #[tokio::test]
    async fn caskroom_path_detected() {
        let cmd = TokioCommandRunner;
        let result = detect_from_brew(
            "/usr/local/Caskroom/my-app/1.0/my-app.app/bin/my-app",
            None,
            &cmd,
        )
        .await;
        assert!(result.is_some());
    }

    #[tokio::test]
    async fn linuxbrew_path_detected() {
        let cmd = TokioCommandRunner;
        let result = detect_from_brew("/home/linuxbrew/.linuxbrew/bin/my-app", None, &cmd).await;
        assert!(result.is_some());
    }

    // ── MockCommandRunner tests ──

    use crate::test_utils::MockCommandRunner;

    #[tokio::test]
    async fn verified_cask_high_confidence() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew list --cask my-cask",
            Ok(MockCommandRunner::success_output("my-cask")),
        );

        let result = detect_from_brew("/opt/homebrew/bin/my-app", Some("my-cask"), &cmd).await;
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::BrewCask);
        assert_eq!(detection.confidence, Confidence::High);
        assert!(detection.evidence.len() >= 2); // path + verify
    }

    #[tokio::test]
    async fn failed_verification_medium_confidence() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew list --cask my-cask",
            Ok(MockCommandRunner::failure_output("Error")),
        );

        let result = detect_from_brew("/opt/homebrew/bin/my-app", Some("my-cask"), &cmd).await;
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::BrewCask);
        assert_eq!(detection.confidence, Confidence::Medium);
        assert_eq!(detection.evidence.len(), 1); // path only
    }

    #[tokio::test]
    async fn brew_command_not_found_medium_confidence() {
        let cmd = MockCommandRunner::new();
        // No response registered — will return error

        let result = detect_from_brew("/opt/homebrew/bin/my-app", Some("my-cask"), &cmd).await;
        let detection = result.unwrap();
        assert_eq!(detection.confidence, Confidence::Medium);
    }

    #[tokio::test]
    async fn evidence_source_is_brew_path() {
        let cmd = MockCommandRunner::new();
        let result = detect_from_brew("/opt/homebrew/bin/my-app", None, &cmd).await;
        let detection = result.unwrap();
        assert!(detection.evidence.iter().any(|e| e.source == "brew-path"));
    }

    #[tokio::test]
    async fn evidence_has_verify_on_success() {
        let cmd = MockCommandRunner::new();
        cmd.on(
            "brew list --cask my-cask",
            Ok(MockCommandRunner::success_output("")),
        );

        let result = detect_from_brew("/opt/homebrew/bin/my-app", Some("my-cask"), &cmd).await;
        let detection = result.unwrap();
        assert!(detection
            .evidence
            .iter()
            .any(|e| e.source == "brew-verify"));
    }

    #[tokio::test]
    async fn usr_local_caskroom_detected() {
        let cmd = MockCommandRunner::new();
        let result =
            detect_from_brew("/usr/local/Caskroom/my-app/1.0/bin/my-app", None, &cmd).await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().channel, Channel::BrewCask);
    }

    #[tokio::test]
    async fn non_brew_path_with_cask_name_returns_none() {
        // Even with cask_name provided, non-brew path should return None
        let cmd = MockCommandRunner::new();
        let result = detect_from_brew("/usr/bin/my-app", Some("my-cask"), &cmd).await;
        assert!(result.is_none());
    }
}
