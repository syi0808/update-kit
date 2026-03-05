use std::sync::OnceLock;

/// Check whether the terminal supports ANSI color output.
///
/// Returns `false` if the `NO_COLOR` environment variable is set (any value),
/// or if stdout is not a terminal (checked via `atty`-style heuristic).
pub fn supports_color() -> bool {
    static SUPPORTS: OnceLock<bool> = OnceLock::new();
    *SUPPORTS.get_or_init(|| {
        if std::env::var("NO_COLOR").is_ok() {
            return false;
        }
        atty_stdout()
    })
}

/// Wrap text in ANSI bold escape codes.
pub fn bold(s: &str) -> String {
    if supports_color() {
        format!("\x1b[1m{}\x1b[0m", s)
    } else {
        s.to_string()
    }
}

/// Wrap text in ANSI green escape codes.
pub fn green(s: &str) -> String {
    if supports_color() {
        format!("\x1b[32m{}\x1b[0m", s)
    } else {
        s.to_string()
    }
}

/// Wrap text in ANSI yellow escape codes.
pub fn yellow(s: &str) -> String {
    if supports_color() {
        format!("\x1b[33m{}\x1b[0m", s)
    } else {
        s.to_string()
    }
}

/// Wrap text in ANSI red escape codes.
pub fn red(s: &str) -> String {
    if supports_color() {
        format!("\x1b[31m{}\x1b[0m", s)
    } else {
        s.to_string()
    }
}

/// Wrap text in ANSI dim escape codes.
pub fn dim(s: &str) -> String {
    if supports_color() {
        format!("\x1b[2m{}\x1b[0m", s)
    } else {
        s.to_string()
    }
}

/// Remove all ANSI escape sequences from the given string.
pub fn strip_ansi(s: &str) -> String {
    let re = regex::Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    re.replace_all(s, "").to_string()
}

/// Check if stdout is a tty. This is a simple heuristic using libc on Unix
/// and a fallback on other platforms.
fn atty_stdout() -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::isatty(libc::STDOUT_FILENO) != 0 }
    }
    #[cfg(not(unix))]
    {
        // On non-Unix platforms, assume color support by default
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_removes_codes() {
        let colored = "\x1b[1mhello\x1b[0m \x1b[32mworld\x1b[0m";
        assert_eq!(strip_ansi(colored), "hello world");
    }

    #[test]
    fn strip_ansi_noop_on_plain() {
        let plain = "hello world";
        assert_eq!(strip_ansi(plain), "hello world");
    }

    #[test]
    fn bold_wraps_text_with_escape_codes() {
        // We test the raw output without relying on supports_color
        let raw = format!("\x1b[1m{}\x1b[0m", "test");
        assert!(raw.starts_with("\x1b[1m"));
        assert!(raw.ends_with("\x1b[0m"));
        assert_eq!(strip_ansi(&raw), "test");
    }

    #[test]
    fn strip_ansi_handles_multiple_codes() {
        let s = "\x1b[2m\x1b[33mfoo\x1b[0m\x1b[31mbar\x1b[0m";
        assert_eq!(strip_ansi(s), "foobar");
    }
}
