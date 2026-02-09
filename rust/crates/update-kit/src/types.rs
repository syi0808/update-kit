use serde::{Deserialize, Serialize};

use crate::errors::UpdateKitError;

/// The install channel through which the application was installed.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Channel {
    Native,
    Unmanaged,
    NpmGlobal,
    BrewCask,
    Custom(String),
}

impl Serialize for Channel {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Channel::Native => serializer.serialize_str("native"),
            Channel::Unmanaged => serializer.serialize_str("unmanaged"),
            Channel::NpmGlobal => serializer.serialize_str("npm-global"),
            Channel::BrewCask => serializer.serialize_str("brew-cask"),
            Channel::Custom(s) => serializer.serialize_str(s),
        }
    }
}

impl<'de> Deserialize<'de> for Channel {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Ok(match s.as_str() {
            "native" => Channel::Native,
            "unmanaged" => Channel::Unmanaged,
            "npm-global" => Channel::NpmGlobal,
            "brew-cask" => Channel::BrewCask,
            _ => Channel::Custom(s),
        })
    }
}

/// Confidence level for install detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    None,
    Low,
    Medium,
    High,
}

/// A piece of evidence supporting an install detection result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evidence {
    pub source: String,
    pub detail: String,
}

/// Result of detecting how the application was installed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallDetection {
    pub channel: Channel,
    pub confidence: Confidence,
    pub evidence: Vec<Evidence>,
}

/// Whether to check for updates synchronously or asynchronously.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckMode {
    Blocking,
    NonBlocking,
}

/// Information about a downloadable release asset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetInfo {
    pub name: String,
    pub url: String,
    pub size: Option<u64>,
    pub checksum_url: Option<String>,
}

/// The result of checking for updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum UpdateStatus {
    Available {
        current: String,
        latest: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        release_url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        release_notes: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        assets: Option<Vec<AssetInfo>>,
    },
    UpToDate {
        current: String,
    },
    Unknown {
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        cached_latest: Option<String>,
    },
}

/// Whether a delegate command should be printed or executed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DelegateMode {
    PrintOnly,
    Execute,
}

/// The strategy for applying an update.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PlanKind {
    NativeInPlace {
        download_url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        checksum_url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        expected_checksum: Option<String>,
    },
    DelegateCommand {
        channel: Channel,
        command: Vec<String>,
        mode: DelegateMode,
    },
    ManualInstall {
        reason: String,
        instructions: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        download_url: Option<String>,
    },
}

/// Action to take after applying an update.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PostAction {
    SuggestRestart,
    ExitAfterApply,
    Reexec,
    None,
}

/// A complete update plan describing what to do and how.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlan {
    pub kind: PlanKind,
    pub from_version: String,
    pub to_version: String,
    pub post_action: PostAction,
}

/// Which output stream a command is writing to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputStream {
    Stdout,
    Stderr,
}

/// Progress updates during the apply phase.
#[derive(Debug)]
pub enum ApplyProgress {
    Downloading {
        bytes_downloaded: u64,
        total_bytes: Option<u64>,
    },
    Verifying,
    Extracting,
    Replacing,
    Executing {
        output: String,
        stream: OutputStream,
    },
    Done,
}

/// The result of applying an update.
#[derive(Debug)]
pub enum ApplyResult {
    Success {
        from_version: String,
        to_version: String,
        post_action: PostAction,
    },
    UpToDate {
        current: String,
    },
    NeedsRestart {
        message: String,
    },
    Failed {
        error: Box<UpdateKitError>,
        rollback_succeeded: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_channel_equality() {
        assert_eq!(Channel::Native, Channel::Native);
        assert_ne!(Channel::Native, Channel::BrewCask);
        assert_eq!(
            Channel::Custom("snap".into()),
            Channel::Custom("snap".into())
        );
        assert_ne!(
            Channel::Custom("snap".into()),
            Channel::Custom("flatpak".into())
        );
    }

    #[test]
    fn test_channel_custom() {
        let ch = Channel::Custom("my-channel".into());
        if let Channel::Custom(name) = &ch {
            assert_eq!(name, "my-channel");
        } else {
            panic!("expected Custom variant");
        }
    }

    #[test]
    fn test_confidence_ordering() {
        assert!(Confidence::None < Confidence::Low);
        assert!(Confidence::Low < Confidence::Medium);
        assert!(Confidence::Medium < Confidence::High);
        assert!(Confidence::None < Confidence::High);
    }

    #[test]
    fn test_update_status_available() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: Some("https://example.com".into()),
            release_notes: None,
            assets: None,
        };
        match &status {
            UpdateStatus::Available {
                current, latest, ..
            } => {
                assert_eq!(current, "1.0.0");
                assert_eq!(latest, "2.0.0");
            }
            _ => panic!("expected Available"),
        }
    }

    #[test]
    fn test_update_status_up_to_date() {
        let status = UpdateStatus::UpToDate {
            current: "1.0.0".into(),
        };
        match &status {
            UpdateStatus::UpToDate { current } => assert_eq!(current, "1.0.0"),
            _ => panic!("expected UpToDate"),
        }
    }

    #[test]
    fn test_update_status_unknown() {
        let status = UpdateStatus::Unknown {
            reason: "network error".into(),
            cached_latest: Some("1.5.0".into()),
        };
        match &status {
            UpdateStatus::Unknown {
                reason,
                cached_latest,
            } => {
                assert_eq!(reason, "network error");
                assert_eq!(cached_latest.as_deref(), Some("1.5.0"));
            }
            _ => panic!("expected Unknown"),
        }
    }

    #[test]
    fn test_plan_kind_native() {
        let plan = PlanKind::NativeInPlace {
            download_url: "https://example.com/app.tar.gz".into(),
            checksum_url: Some("https://example.com/sha256".into()),
            expected_checksum: None,
        };
        match &plan {
            PlanKind::NativeInPlace { download_url, .. } => {
                assert_eq!(download_url, "https://example.com/app.tar.gz");
            }
            _ => panic!("expected NativeInPlace"),
        }
    }

    #[test]
    fn test_plan_kind_delegate() {
        let plan = PlanKind::DelegateCommand {
            channel: Channel::NpmGlobal,
            command: vec!["npm".into(), "update".into(), "-g".into(), "myapp".into()],
            mode: DelegateMode::PrintOnly,
        };
        match &plan {
            PlanKind::DelegateCommand {
                channel,
                command,
                mode,
            } => {
                assert_eq!(*channel, Channel::NpmGlobal);
                assert_eq!(command.len(), 4);
                assert_eq!(*mode, DelegateMode::PrintOnly);
            }
            _ => panic!("expected DelegateCommand"),
        }
    }

    #[test]
    fn test_plan_kind_manual() {
        let plan = PlanKind::ManualInstall {
            reason: "unsupported channel".into(),
            instructions: "Download from website".into(),
            download_url: Some("https://example.com".into()),
        };
        match &plan {
            PlanKind::ManualInstall {
                reason,
                instructions,
                ..
            } => {
                assert_eq!(reason, "unsupported channel");
                assert_eq!(instructions, "Download from website");
            }
            _ => panic!("expected ManualInstall"),
        }
    }

    #[test]
    fn test_apply_result_success() {
        let result = ApplyResult::Success {
            from_version: "1.0.0".into(),
            to_version: "2.0.0".into(),
            post_action: PostAction::SuggestRestart,
        };
        match &result {
            ApplyResult::Success {
                from_version,
                to_version,
                post_action,
            } => {
                assert_eq!(from_version, "1.0.0");
                assert_eq!(to_version, "2.0.0");
                assert_eq!(*post_action, PostAction::SuggestRestart);
            }
            _ => panic!("expected Success"),
        }
    }

    #[test]
    fn test_apply_result_failed() {
        let err = UpdateKitError::DownloadFailed("timeout".into());
        let result = ApplyResult::Failed {
            error: Box::new(err),
            rollback_succeeded: true,
        };
        match &result {
            ApplyResult::Failed {
                error,
                rollback_succeeded,
            } => {
                assert_eq!(error.code(), "DOWNLOAD_FAILED");
                assert!(*rollback_succeeded);
            }
            _ => panic!("expected Failed"),
        }
    }

    #[test]
    fn test_channel_serialization_known_variants() {
        assert_eq!(
            serde_json::to_string(&Channel::Native).unwrap(),
            "\"native\""
        );
        assert_eq!(
            serde_json::to_string(&Channel::Unmanaged).unwrap(),
            "\"unmanaged\""
        );
        assert_eq!(
            serde_json::to_string(&Channel::NpmGlobal).unwrap(),
            "\"npm-global\""
        );
        assert_eq!(
            serde_json::to_string(&Channel::BrewCask).unwrap(),
            "\"brew-cask\""
        );
    }

    #[test]
    fn test_channel_serialization_custom() {
        let ch = Channel::Custom("snap-store".into());
        assert_eq!(serde_json::to_string(&ch).unwrap(), "\"snap-store\"");
    }

    #[test]
    fn test_channel_deserialization_known() {
        let ch: Channel = serde_json::from_str("\"native\"").unwrap();
        assert_eq!(ch, Channel::Native);

        let ch: Channel = serde_json::from_str("\"npm-global\"").unwrap();
        assert_eq!(ch, Channel::NpmGlobal);

        let ch: Channel = serde_json::from_str("\"brew-cask\"").unwrap();
        assert_eq!(ch, Channel::BrewCask);
    }

    #[test]
    fn test_channel_deserialization_custom() {
        let ch: Channel = serde_json::from_str("\"flatpak\"").unwrap();
        assert_eq!(ch, Channel::Custom("flatpak".into()));
    }

    #[test]
    fn test_channel_roundtrip() {
        let channels = vec![
            Channel::Native,
            Channel::Unmanaged,
            Channel::NpmGlobal,
            Channel::BrewCask,
            Channel::Custom("my-store".into()),
        ];
        for ch in channels {
            let json = serde_json::to_string(&ch).unwrap();
            let deserialized: Channel = serde_json::from_str(&json).unwrap();
            assert_eq!(ch, deserialized);
        }
    }
}
