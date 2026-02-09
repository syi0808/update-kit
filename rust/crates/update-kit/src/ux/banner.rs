use crate::types::{Channel, Confidence, InstallDetection, UpdateStatus};
use crate::ux::colors::{green, strip_ansi, yellow};

/// Render an update notification banner.
///
/// Returns `Some(banner)` when the status is `Available`, `None` otherwise.
/// The banner is a box-drawn notification showing the version change,
/// install channel, and suggested update command.
pub fn render_banner(status: &UpdateStatus, detection: &InstallDetection) -> Option<String> {
    let (current, latest, release_url) = match status {
        UpdateStatus::Available {
            current,
            latest,
            release_url,
            ..
        } => (current.as_str(), latest.as_str(), release_url.as_deref()),
        _ => return None,
    };

    let channel_str = format_channel(&detection.channel);
    let confidence_str = format_confidence(detection.confidence);
    let update_hint = format_update_hint(&detection.channel, release_url);

    // Build content lines (without box borders)
    let version_line = format!(
        "Update available: {} -> {}",
        yellow(current),
        yellow(latest)
    );
    let channel_line = format!("Channel: {} ({})", channel_str, confidence_str);
    let hint_line = format!("Run: {}", update_hint);

    // Calculate max visible width (without ANSI codes)
    let lines_plain = [
        strip_ansi(&version_line),
        channel_line.clone(),
        hint_line.clone(),
    ];
    let max_width = lines_plain.iter().map(|l| l.len()).max().unwrap_or(0);
    let inner_width = max_width + 6; // 3 spaces padding on each side

    // Build the box
    let top = format!("  {}{}{}", green("╭"), green(&"─".repeat(inner_width)), green("╯"));
    let bottom = format!("  {}{}{}", green("╰"), green(&"─".repeat(inner_width)), green("╮"));
    let empty_line = format!(
        "  {}{}{}",
        green("│"),
        " ".repeat(inner_width),
        green("│")
    );

    let format_content_line = |line: &str, plain: &str| {
        let visible_len = plain.len();
        let padding = inner_width - 3 - visible_len; // 3 for left padding
        format!(
            "  {}   {}{}{}",
            green("│"),
            line,
            " ".repeat(padding),
            green("│")
        )
    };

    let version_row = format_content_line(&version_line, &lines_plain[0]);
    let channel_row = format_content_line(&channel_line, &lines_plain[1]);
    let hint_row = format_content_line(&hint_line, &lines_plain[2]);

    let banner = [
        top,
        empty_line.clone(),
        version_row,
        empty_line.clone(),
        channel_row,
        hint_row,
        empty_line,
        bottom,
    ]
    .join("\n");

    Some(banner)
}

fn format_channel(channel: &Channel) -> &'static str {
    match channel {
        Channel::Native => "native",
        Channel::Unmanaged => "unmanaged",
        Channel::NpmGlobal => "npm-global",
        Channel::BrewCask => "brew-cask",
        Channel::Custom(_) => "custom",
    }
}

fn format_confidence(confidence: Confidence) -> &'static str {
    match confidence {
        Confidence::None => "none",
        Confidence::Low => "low",
        Confidence::Medium => "medium",
        Confidence::High => "high",
    }
}

fn format_update_hint(channel: &Channel, release_url: Option<&str>) -> String {
    match channel {
        Channel::NpmGlobal => "npm update -g <package>".to_string(),
        Channel::BrewCask => "brew upgrade --cask <app>".to_string(),
        Channel::Native | Channel::Unmanaged | Channel::Custom(_) => {
            if let Some(url) = release_url {
                url.to_string()
            } else {
                "Visit the project page for download".to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Confidence, Evidence};

    fn make_detection(channel: Channel, confidence: Confidence) -> InstallDetection {
        InstallDetection {
            channel,
            confidence,
            evidence: vec![Evidence {
                source: "test".into(),
                detail: "test".into(),
            }],
        }
    }

    #[test]
    fn returns_none_for_up_to_date() {
        let status = UpdateStatus::UpToDate {
            current: "1.0.0".into(),
        };
        let detection = make_detection(Channel::Native, Confidence::High);
        assert!(render_banner(&status, &detection).is_none());
    }

    #[test]
    fn returns_none_for_unknown() {
        let status = UpdateStatus::Unknown {
            reason: "error".into(),
            cached_latest: None,
        };
        let detection = make_detection(Channel::Native, Confidence::High);
        assert!(render_banner(&status, &detection).is_none());
    }

    #[test]
    fn returns_some_for_available() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: Some("https://example.com/release".into()),
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::Native, Confidence::High);
        let banner = render_banner(&status, &detection);
        assert!(banner.is_some());

        let text = banner.unwrap();
        let plain = crate::ux::colors::strip_ansi(&text);
        assert!(plain.contains("Update available"));
        assert!(plain.contains("1.0.0"));
        assert!(plain.contains("2.0.0"));
        assert!(plain.contains("native"));
        assert!(plain.contains("high"));
    }

    #[test]
    fn banner_shows_npm_hint() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::NpmGlobal, Confidence::High);
        let banner = render_banner(&status, &detection).unwrap();
        let plain = crate::ux::colors::strip_ansi(&banner);
        assert!(plain.contains("npm update -g"));
    }

    #[test]
    fn banner_shows_brew_hint() {
        let status = UpdateStatus::Available {
            current: "1.0.0".into(),
            latest: "2.0.0".into(),
            release_url: None,
            release_notes: None,
            assets: None,
        };
        let detection = make_detection(Channel::BrewCask, Confidence::High);
        let banner = render_banner(&status, &detection).unwrap();
        let plain = crate::ux::colors::strip_ansi(&banner);
        assert!(plain.contains("brew upgrade --cask"));
    }
}
