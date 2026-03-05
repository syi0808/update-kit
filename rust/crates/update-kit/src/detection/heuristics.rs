use crate::types::Evidence;

/// Brew path patterns that indicate a Homebrew installation.
const BREW_PATTERNS: &[&str] = &[
    "/opt/homebrew/",
    "/usr/local/Caskroom/",
    "/usr/local/Cellar/",
    "/home/linuxbrew/",
];

/// npm path patterns that indicate an npm global installation.
const NPM_PATTERNS: &[&str] = &["node_modules", "/lib/node_modules/", "/.npm/"];

/// Collects path-based heuristic evidence from the executable path.
///
/// This is a pure function with no I/O. It examines the path string for
/// known patterns that indicate brew or npm installations.
pub fn collect_path_heuristics(exec_path: &str) -> Vec<Evidence> {
    let mut evidence = Vec::new();

    for pattern in BREW_PATTERNS {
        if exec_path.contains(pattern) {
            evidence.push(Evidence {
                source: "path-heuristic".into(),
                detail: format!("path contains brew indicator '{}'", pattern),
            });
        }
    }

    for pattern in NPM_PATTERNS {
        if exec_path.contains(pattern) {
            evidence.push(Evidence {
                source: "path-heuristic".into(),
                detail: format!("path contains npm indicator '{}'", pattern),
            });
        }
    }

    evidence
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn homebrew_path_detected() {
        let evidence = collect_path_heuristics("/opt/homebrew/bin/my-app");
        assert!(!evidence.is_empty());
        assert!(evidence
            .iter()
            .any(|e| e.detail.contains("brew indicator")));
    }

    #[test]
    fn npm_path_detected() {
        let evidence = collect_path_heuristics("/usr/local/lib/node_modules/.bin/my-app");
        assert!(!evidence.is_empty());
        assert!(evidence.iter().any(|e| e.detail.contains("npm indicator")));
    }

    #[test]
    fn random_path_no_evidence() {
        let evidence = collect_path_heuristics("/tmp/random");
        assert!(evidence.is_empty());
    }

    #[test]
    fn multiple_brew_patterns() {
        let evidence = collect_path_heuristics("/usr/local/Cellar/something");
        assert!(!evidence.is_empty());
        assert!(evidence
            .iter()
            .any(|e| e.detail.contains("/usr/local/Cellar/")));
    }

    #[test]
    fn linuxbrew_path_detected() {
        let evidence = collect_path_heuristics("/home/linuxbrew/.linuxbrew/bin/app");
        assert!(!evidence.is_empty());
    }
}
