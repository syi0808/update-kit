use regex::Regex;

use crate::config::{ResolvedConfig, VersionSourceConfig};
use crate::types::Channel;

/// Parse a GitHub repository string into (owner, repo).
///
/// Supported formats:
/// - `https://github.com/owner/repo`
/// - `https://github.com/owner/repo.git`
/// - `git+https://github.com/owner/repo.git`
/// - `github:owner/repo`
/// - `owner/repo` (shorthand)
/// - `{"url": "https://github.com/owner/repo"}` (JSON-like)
pub fn parse_github_repository(repo: &str) -> Option<(String, String)> {
    let repo = repo.trim();

    // Handle JSON-like format: {"url": "..."}
    if repo.starts_with('{') {
        let json: serde_json::Value = serde_json::from_str(repo).ok()?;
        let url = json.get("url")?.as_str()?;
        return parse_github_repository(url);
    }

    // Handle github: shorthand
    if let Some(rest) = repo.strip_prefix("github:") {
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
        return None;
    }

    // Handle git+https:// prefix
    let url = repo.strip_prefix("git+").unwrap_or(repo);

    // Handle https://github.com/owner/repo[.git]
    let re = Regex::new(r"^https?://github\.com/([^/]+)/([^/.]+)(?:\.git)?/?$").unwrap();
    if let Some(caps) = re.captures(url) {
        let owner = caps.get(1)?.as_str().to_string();
        let repo_name = caps.get(2)?.as_str().to_string();
        return Some((owner, repo_name));
    }

    // Handle ssh format: git@github.com:owner/repo.git
    let ssh_re = Regex::new(r"^git@github\.com:([^/]+)/([^/.]+)(?:\.git)?$").unwrap();
    if let Some(caps) = ssh_re.captures(url) {
        let owner = caps.get(1)?.as_str().to_string();
        let repo_name = caps.get(2)?.as_str().to_string();
        return Some((owner, repo_name));
    }

    // Handle owner/repo shorthand (no slashes beyond one)
    let parts: Vec<&str> = url.splitn(2, '/').collect();
    if parts.len() == 2
        && !parts[0].is_empty()
        && !parts[1].is_empty()
        && !parts[0].contains(':')
        && !parts[0].contains('.')
    {
        return Some((parts[0].to_string(), parts[1].to_string()));
    }

    None
}

/// Auto-infer version source configurations from the resolved config.
pub fn infer_source_configs(config: &ResolvedConfig) -> Vec<VersionSourceConfig> {
    let mut sources = Vec::new();

    // Always include npm
    let npm_name = config
        .base
        .npm_package_name
        .clone()
        .unwrap_or_else(|| config.app_name.clone());
    sources.push(VersionSourceConfig::Npm {
        package_name: npm_name,
        registry_url: None,
    });

    // Include GitHub if repository resolves
    if let Some(ref repo) = config.base.repository {
        if let Some((owner, repo_name)) = parse_github_repository(repo) {
            sources.push(VersionSourceConfig::Github {
                owner,
                repo: repo_name,
                token: None,
                api_base_url: None,
            });
        }
    }

    // Include Brew only if explicitly set
    if let Some(ref cask_name) = config.base.brew_cask_name {
        sources.push(VersionSourceConfig::Brew {
            cask_name: cask_name.clone(),
        });
    }

    sources
}

/// Reorder sources based on the detected install channel.
///
/// - NpmGlobal: [npm, github, brew, ...rest]
/// - BrewCask: [brew, github, npm, ...rest]
/// - Native/Unmanaged/Custom: [github, npm, brew, ...rest]
pub fn order_sources_by_channel(
    sources: Vec<VersionSourceConfig>,
    channel: &Channel,
) -> Vec<VersionSourceConfig> {
    let priority_order: Vec<&str> = match channel {
        Channel::NpmGlobal => vec!["npm", "github", "brew"],
        Channel::BrewCask => vec!["brew", "github", "npm"],
        _ => vec!["github", "npm", "brew"],
    };

    let mut ordered: Vec<VersionSourceConfig> = Vec::with_capacity(sources.len());
    let mut remaining: Vec<VersionSourceConfig> = sources;

    for expected in &priority_order {
        if let Some(idx) = remaining.iter().position(|s| source_type_name(s) == *expected) {
            ordered.push(remaining.remove(idx));
        }
    }

    // Append anything left (custom, jsr, etc.)
    ordered.extend(remaining);
    ordered
}

/// Returns a short type name for a VersionSourceConfig variant.
fn source_type_name(config: &VersionSourceConfig) -> &'static str {
    match config {
        VersionSourceConfig::Github { .. } => "github",
        VersionSourceConfig::Npm { .. } => "npm",
        VersionSourceConfig::Jsr { .. } => "jsr",
        VersionSourceConfig::Brew { .. } => "brew",
        VersionSourceConfig::Custom { .. } => "custom",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::BaseConfig;

    #[test]
    fn test_parse_github_url() {
        let result = parse_github_repository("https://github.com/user/project");
        assert_eq!(result, Some(("user".into(), "project".into())));
    }

    #[test]
    fn test_parse_github_url_with_git_suffix() {
        let result = parse_github_repository("https://github.com/user/project.git");
        assert_eq!(result, Some(("user".into(), "project".into())));
    }

    #[test]
    fn test_parse_github_git_plus_https() {
        let result = parse_github_repository("git+https://github.com/user/project.git");
        assert_eq!(result, Some(("user".into(), "project".into())));
    }

    #[test]
    fn test_parse_github_shorthand() {
        let result = parse_github_repository("github:user/project");
        assert_eq!(result, Some(("user".into(), "project".into())));
    }

    #[test]
    fn test_parse_github_owner_repo() {
        let result = parse_github_repository("user/project");
        assert_eq!(result, Some(("user".into(), "project".into())));
    }

    #[test]
    fn test_parse_github_json_url() {
        let result =
            parse_github_repository(r#"{"url": "https://github.com/user/project"}"#);
        assert_eq!(result, Some(("user".into(), "project".into())));
    }

    #[test]
    fn test_parse_github_invalid() {
        assert!(parse_github_repository("not-a-repo").is_none());
        assert!(parse_github_repository("").is_none());
    }

    #[test]
    fn test_infer_source_configs_basic() {
        let config = ResolvedConfig {
            app_name: "my-app".into(),
            current_version: semver::Version::new(1, 0, 0),
            base: BaseConfig {
                repository: Some("https://github.com/user/repo".into()),
                brew_cask_name: Some("my-app".into()),
                ..Default::default()
            },
        };
        let sources = infer_source_configs(&config);
        assert_eq!(sources.len(), 3);
        assert!(matches!(&sources[0], VersionSourceConfig::Npm { .. }));
        assert!(matches!(&sources[1], VersionSourceConfig::Github { .. }));
        assert!(matches!(&sources[2], VersionSourceConfig::Brew { .. }));
    }

    #[test]
    fn test_infer_source_configs_no_brew() {
        let config = ResolvedConfig {
            app_name: "my-app".into(),
            current_version: semver::Version::new(1, 0, 0),
            base: BaseConfig {
                repository: Some("https://github.com/user/repo".into()),
                ..Default::default()
            },
        };
        let sources = infer_source_configs(&config);
        assert_eq!(sources.len(), 2);
        assert!(matches!(&sources[0], VersionSourceConfig::Npm { .. }));
        assert!(matches!(&sources[1], VersionSourceConfig::Github { .. }));
    }

    #[test]
    fn test_order_sources_npm_channel() {
        let sources = vec![
            VersionSourceConfig::Github {
                owner: "u".into(),
                repo: "r".into(),
                token: None,
                api_base_url: None,
            },
            VersionSourceConfig::Npm {
                package_name: "pkg".into(),
                registry_url: None,
            },
            VersionSourceConfig::Brew {
                cask_name: "app".into(),
            },
        ];

        let ordered = order_sources_by_channel(sources, &Channel::NpmGlobal);
        assert_eq!(source_type_name(&ordered[0]), "npm");
        assert_eq!(source_type_name(&ordered[1]), "github");
        assert_eq!(source_type_name(&ordered[2]), "brew");
    }

    #[test]
    fn test_order_sources_brew_channel() {
        let sources = vec![
            VersionSourceConfig::Github {
                owner: "u".into(),
                repo: "r".into(),
                token: None,
                api_base_url: None,
            },
            VersionSourceConfig::Npm {
                package_name: "pkg".into(),
                registry_url: None,
            },
            VersionSourceConfig::Brew {
                cask_name: "app".into(),
            },
        ];

        let ordered = order_sources_by_channel(sources, &Channel::BrewCask);
        assert_eq!(source_type_name(&ordered[0]), "brew");
        assert_eq!(source_type_name(&ordered[1]), "github");
        assert_eq!(source_type_name(&ordered[2]), "npm");
    }

    #[test]
    fn test_order_sources_native_channel() {
        let sources = vec![
            VersionSourceConfig::Npm {
                package_name: "pkg".into(),
                registry_url: None,
            },
            VersionSourceConfig::Brew {
                cask_name: "app".into(),
            },
            VersionSourceConfig::Github {
                owner: "u".into(),
                repo: "r".into(),
                token: None,
                api_base_url: None,
            },
        ];

        let ordered = order_sources_by_channel(sources, &Channel::Native);
        assert_eq!(source_type_name(&ordered[0]), "github");
        assert_eq!(source_type_name(&ordered[1]), "npm");
        assert_eq!(source_type_name(&ordered[2]), "brew");
    }

    #[test]
    fn test_order_preserves_extra_sources() {
        let sources = vec![
            VersionSourceConfig::Custom {
                url: "https://example.com".into(),
                version_field: None,
            },
            VersionSourceConfig::Npm {
                package_name: "pkg".into(),
                registry_url: None,
            },
        ];

        let ordered = order_sources_by_channel(sources, &Channel::NpmGlobal);
        assert_eq!(source_type_name(&ordered[0]), "npm");
        assert_eq!(source_type_name(&ordered[1]), "custom");
    }
}
