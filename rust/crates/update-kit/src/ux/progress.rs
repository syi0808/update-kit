use crate::types::{ApplyProgress, ApplyResult, PostAction};
use crate::ux::colors::{dim, green, red, yellow};

/// Render a human-readable string for an apply progress update.
pub fn render_progress(progress: &ApplyProgress) -> String {
    match progress {
        ApplyProgress::Downloading {
            bytes_downloaded,
            total_bytes,
        } => {
            let downloaded = format_bytes(*bytes_downloaded);
            match total_bytes {
                Some(total) => {
                    let total_str = format_bytes(*total);
                    let pct = if *total > 0 {
                        (*bytes_downloaded as f64 / *total as f64 * 100.0) as u64
                    } else {
                        0
                    };
                    dim(&format!("Downloading... {} / {} ({}%)", downloaded, total_str, pct))
                }
                None => dim(&format!("Downloading... {}", downloaded)),
            }
        }
        ApplyProgress::Verifying => yellow("Verifying checksum..."),
        ApplyProgress::Extracting => yellow("Extracting archive..."),
        ApplyProgress::Replacing => yellow("Replacing binary..."),
        ApplyProgress::Executing { output, stream } => {
            let prefix = match stream {
                crate::types::OutputStream::Stdout => "stdout",
                crate::types::OutputStream::Stderr => "stderr",
            };
            dim(&format!("[{}] {}", prefix, output))
        }
        ApplyProgress::Done => green("Done!"),
    }
}

/// Render a human-readable string for an apply result.
pub fn render_result(result: &ApplyResult) -> String {
    match result {
        ApplyResult::Success {
            from_version,
            to_version,
            post_action,
        } => {
            let action_hint = match post_action {
                PostAction::SuggestRestart => " Please restart the application.",
                PostAction::ExitAfterApply => " The application will exit.",
                PostAction::Reexec => " Re-executing...",
                PostAction::None => "",
            };
            green(&format!(
                "Successfully updated from {} to {}.{}",
                from_version, to_version, action_hint
            ))
        }
        ApplyResult::UpToDate { current } => {
            green(&format!("Already up to date (v{}).", current))
        }
        ApplyResult::NeedsRestart { message } => {
            yellow(&format!("Update applied. {}", message))
        }
        ApplyResult::Failed {
            error,
            rollback_succeeded,
        } => {
            let rollback_msg = if *rollback_succeeded {
                " Rollback succeeded."
            } else {
                " Rollback failed."
            };
            red(&format!("Update failed: {}{}", error, rollback_msg))
        }
    }
}

fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ux::colors::strip_ansi;

    #[test]
    fn render_progress_downloading_with_total() {
        let progress = ApplyProgress::Downloading {
            bytes_downloaded: 512_000,
            total_bytes: Some(1_024_000),
        };
        let text = render_progress(&progress);
        assert!(!text.is_empty());
        let plain = strip_ansi(&text);
        assert!(plain.contains("Downloading"));
        assert!(plain.contains("50%"));
    }

    #[test]
    fn render_progress_downloading_without_total() {
        let progress = ApplyProgress::Downloading {
            bytes_downloaded: 1024,
            total_bytes: None,
        };
        let text = render_progress(&progress);
        assert!(!text.is_empty());
        let plain = strip_ansi(&text);
        assert!(plain.contains("Downloading"));
    }

    #[test]
    fn render_progress_verifying() {
        let text = render_progress(&ApplyProgress::Verifying);
        assert!(!text.is_empty());
        let plain = strip_ansi(&text);
        assert!(plain.contains("Verifying"));
    }

    #[test]
    fn render_progress_extracting() {
        let text = render_progress(&ApplyProgress::Extracting);
        assert!(!text.is_empty());
        let plain = strip_ansi(&text);
        assert!(plain.contains("Extracting"));
    }

    #[test]
    fn render_progress_replacing() {
        let text = render_progress(&ApplyProgress::Replacing);
        assert!(!text.is_empty());
        let plain = strip_ansi(&text);
        assert!(plain.contains("Replacing"));
    }

    #[test]
    fn render_progress_executing() {
        let progress = ApplyProgress::Executing {
            output: "installing...".into(),
            stream: crate::types::OutputStream::Stdout,
        };
        let text = render_progress(&progress);
        assert!(!text.is_empty());
        let plain = strip_ansi(&text);
        assert!(plain.contains("stdout"));
        assert!(plain.contains("installing"));
    }

    #[test]
    fn render_progress_done() {
        let text = render_progress(&ApplyProgress::Done);
        assert!(!text.is_empty());
        let plain = strip_ansi(&text);
        assert!(plain.contains("Done"));
    }

    #[test]
    fn render_result_success() {
        let result = ApplyResult::Success {
            from_version: "1.0.0".into(),
            to_version: "2.0.0".into(),
            post_action: PostAction::SuggestRestart,
        };
        let text = render_result(&result);
        let plain = strip_ansi(&text);
        assert!(plain.contains("Successfully updated"));
        assert!(plain.contains("1.0.0"));
        assert!(plain.contains("2.0.0"));
        assert!(plain.contains("restart"));
    }

    #[test]
    fn render_result_up_to_date() {
        let result = ApplyResult::UpToDate {
            current: "1.0.0".into(),
        };
        let text = render_result(&result);
        let plain = strip_ansi(&text);
        assert!(plain.contains("up to date"));
    }

    #[test]
    fn render_result_failed() {
        let result = ApplyResult::Failed {
            error: Box::new(crate::errors::UpdateKitError::DownloadFailed(
                "timeout".into(),
            )),
            rollback_succeeded: true,
        };
        let text = render_result(&result);
        let plain = strip_ansi(&text);
        assert!(plain.contains("failed"));
        assert!(plain.contains("Rollback succeeded"));
    }
}
