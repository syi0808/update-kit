use crate::types::{Channel, Confidence, Evidence, InstallDetection};
use crate::utils::process::CommandRunner;

/// Path patterns that indicate an npm global installation.
const NPM_PATH_PATTERNS: &[&str] = &["node_modules", "/lib/node_modules/", "/.npm/"];

/// Detects installation via npm global by checking path patterns and optionally
/// verifying with `npm prefix -g`.
///
/// If the executable path contains an npm pattern, detection is triggered.
/// Runs `npm prefix -g` to verify the path starts with the npm global prefix,
/// yielding High confidence on match. Otherwise, Medium confidence is returned.
pub async fn detect_from_npm(exec_path: &str, cmd: &dyn CommandRunner) -> Option<InstallDetection> {
    let matching_pattern = NPM_PATH_PATTERNS
        .iter()
        .find(|pattern| exec_path.contains(*pattern));

    let pattern = matching_pattern?;
    let mut evidence = vec![Evidence {
        source: "npm-path".into(),
        detail: format!("path contains npm pattern '{}'", pattern),
    }];

    // Try to verify with npm prefix -g
    match cmd.run("npm", &["prefix", "-g"]).await {
        Ok(output) if output.success() => {
            let prefix = output.stdout.trim().to_string();
            if exec_path.starts_with(&prefix) {
                evidence.push(Evidence {
                    source: "npm-verify".into(),
                    detail: format!("path starts with npm global prefix '{}'", prefix),
                });
                return Some(InstallDetection {
                    channel: Channel::NpmGlobal,
                    confidence: Confidence::High,
                    evidence,
                });
            }
        }
        _ => {
            // npm not available or failed, fall through to Medium
        }
    }

    Some(InstallDetection {
        channel: Channel::NpmGlobal,
        confidence: Confidence::Medium,
        evidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::process::TokioCommandRunner;

    #[tokio::test]
    async fn npm_path_with_node_modules() {
        let cmd = TokioCommandRunner;
        let result = detect_from_npm("/usr/local/lib/node_modules/.bin/my-app", &cmd).await;
        assert!(result.is_some());
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::NpmGlobal);
        // Confidence depends on whether npm is available in test env
        assert!(detection.confidence >= Confidence::Medium);
    }

    #[tokio::test]
    async fn non_npm_path_returns_none() {
        let cmd = TokioCommandRunner;
        let result = detect_from_npm("/usr/local/bin/my-app", &cmd).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn npm_dot_npm_path() {
        let cmd = TokioCommandRunner;
        let result = detect_from_npm("/home/user/.npm/bin/my-app", &cmd).await;
        assert!(result.is_some());
        let detection = result.unwrap();
        assert_eq!(detection.channel, Channel::NpmGlobal);
    }
}
