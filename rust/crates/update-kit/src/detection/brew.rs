use crate::types::{Channel, Confidence, Evidence, InstallDetection};

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
) -> Option<InstallDetection> {
    let matching_pattern = BREW_PATH_PATTERNS
        .iter()
        .find(|pattern| exec_path.contains(*pattern));

    if matching_pattern.is_none() {
        return None;
    }

    let pattern = matching_pattern.unwrap();
    let mut evidence = vec![Evidence {
        source: "brew-path".into(),
        detail: format!("path contains brew pattern '{}'", pattern),
    }];

    // If a cask name is provided, try to verify with brew
    if let Some(cask_name) = brew_cask_name {
        match tokio::process::Command::new("brew")
            .args(["list", "--cask", cask_name])
            .output()
            .await
        {
            Ok(output) if output.status.success() => {
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

    #[tokio::test]
    async fn brew_path_detected_without_cask_name() {
        let result = detect_from_brew("/opt/homebrew/bin/my-app", None).await;
        assert!(result.is_some());
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::BrewCask);
        assert_eq!(detection.confidence, Confidence::Medium);
    }

    #[tokio::test]
    async fn non_brew_path_returns_none() {
        let result = detect_from_brew("/usr/bin/my-app", None).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn cellar_path_detected() {
        let result = detect_from_brew("/usr/local/Cellar/my-app/1.0/bin/my-app", None).await;
        assert!(result.is_some());
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::BrewCask);
    }

    #[tokio::test]
    async fn caskroom_path_detected() {
        let result =
            detect_from_brew("/usr/local/Caskroom/my-app/1.0/my-app.app/bin/my-app", None).await;
        assert!(result.is_some());
    }

    #[tokio::test]
    async fn linuxbrew_path_detected() {
        let result = detect_from_brew("/home/linuxbrew/.linuxbrew/bin/my-app", None).await;
        assert!(result.is_some());
    }
}
