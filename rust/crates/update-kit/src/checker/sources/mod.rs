pub mod brew_api;
pub mod custom_manifest;
pub mod github;
pub mod jsr;
pub mod npm_registry;

use crate::config::VersionSourceConfig;
use crate::errors::UpdateKitError;
use crate::types::AssetInfo;
use serde::{Deserialize, Serialize};

/// Information about a specific version.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub version: String,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
    pub assets: Option<Vec<AssetInfo>>,
    pub published_at: Option<String>,
}

/// Result of fetching the latest version from a source.
#[derive(Debug)]
pub enum VersionSourceResult {
    Found {
        info: VersionInfo,
        etag: Option<String>,
    },
    NotModified {
        etag: String,
    },
    Error {
        reason: String,
        status: Option<u16>,
    },
}

/// Options for fetching the latest version.
#[derive(Debug, Default)]
pub struct FetchOptions {
    pub etag: Option<String>,
}

/// Options for fetching a list of versions.
#[derive(Debug, Default)]
pub struct FetchVersionsOptions {
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

/// Result of fetching a list of versions.
#[derive(Debug)]
pub enum VersionListResult {
    Success {
        versions: Vec<VersionInfo>,
        next_cursor: Option<String>,
        total_count: Option<usize>,
    },
    Error {
        reason: String,
    },
}

/// Trait for version sources that can check for updates.
#[async_trait::async_trait]
pub trait VersionSource: Send + Sync {
    /// Returns the name of this source (e.g. "github", "npm").
    fn name(&self) -> &str;

    /// Fetch the latest version from this source.
    async fn fetch_latest(&self, options: FetchOptions) -> VersionSourceResult;

    /// Fetch a paginated list of versions. Not all sources support this.
    async fn fetch_versions(
        &self,
        _options: FetchVersionsOptions,
    ) -> Result<VersionListResult, UpdateKitError> {
        Err(UpdateKitError::UnsupportedOperation(
            "fetch_versions not supported".into(),
        ))
    }
}

/// Create a version source from a configuration variant.
pub fn create_version_source(config: VersionSourceConfig) -> Box<dyn VersionSource> {
    match config {
        VersionSourceConfig::Github {
            owner,
            repo,
            token,
            api_base_url,
        } => Box::new(github::GitHubReleasesSource::new(
            owner,
            repo,
            token,
            api_base_url,
        )),
        VersionSourceConfig::Npm {
            package_name,
            registry_url,
        } => Box::new(npm_registry::NpmRegistrySource::new(
            package_name,
            registry_url,
        )),
        VersionSourceConfig::Jsr { scope, name } => {
            Box::new(jsr::JsrSource::new(scope, name))
        }
        VersionSourceConfig::Brew { cask_name } => {
            Box::new(brew_api::BrewSource::new(cask_name))
        }
        VersionSourceConfig::Custom { url, version_field } => {
            Box::new(custom_manifest::CustomManifestSource::new(url, version_field))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_github_source() {
        let source = create_version_source(VersionSourceConfig::Github {
            owner: "user".into(),
            repo: "repo".into(),
            token: None,
            api_base_url: None,
        });
        assert_eq!(source.name(), "github");
    }

    #[test]
    fn test_create_npm_source() {
        let source = create_version_source(VersionSourceConfig::Npm {
            package_name: "my-pkg".into(),
            registry_url: None,
        });
        assert_eq!(source.name(), "npm");
    }

    #[test]
    fn test_create_jsr_source() {
        let source = create_version_source(VersionSourceConfig::Jsr {
            scope: "scope".into(),
            name: "pkg".into(),
        });
        assert_eq!(source.name(), "jsr");
    }

    #[test]
    fn test_create_brew_source() {
        let source = create_version_source(VersionSourceConfig::Brew {
            cask_name: "my-cask".into(),
        });
        assert_eq!(source.name(), "brew");
    }

    #[test]
    fn test_create_custom_source() {
        let source = create_version_source(VersionSourceConfig::Custom {
            url: "https://example.com/version.json".into(),
            version_field: Some("version".into()),
        });
        assert_eq!(source.name(), "custom");
    }
}
