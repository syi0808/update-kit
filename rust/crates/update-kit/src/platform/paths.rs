use std::path::PathBuf;

/// Returns the default cache directory for the current platform.
///
/// - Windows: `%LOCALAPPDATA%` or `<home>/AppData/Local`
/// - Unix: `$XDG_CACHE_HOME` or `<home>/.cache`
pub fn get_default_cache_dir() -> PathBuf {
    if cfg!(windows) {
        if let Ok(val) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(val);
        }
        if let Some(home) = dirs::home_dir() {
            return home.join("AppData").join("Local");
        }
        PathBuf::from("AppData/Local")
    } else {
        if let Ok(val) = std::env::var("XDG_CACHE_HOME") {
            return PathBuf::from(val);
        }
        if let Some(home) = dirs::home_dir() {
            return home.join(".cache");
        }
        PathBuf::from(".cache")
    }
}

/// Returns the default config directory for the current platform.
///
/// - Windows: `%LOCALAPPDATA%` or `<home>/AppData/Local`
/// - Unix: `$XDG_CONFIG_HOME` or `<home>/.config`
pub fn get_default_config_dir() -> PathBuf {
    if cfg!(windows) {
        if let Ok(val) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(val);
        }
        if let Some(home) = dirs::home_dir() {
            return home.join("AppData").join("Local");
        }
        PathBuf::from("AppData/Local")
    } else {
        if let Ok(val) = std::env::var("XDG_CONFIG_HOME") {
            return PathBuf::from(val);
        }
        if let Some(home) = dirs::home_dir() {
            return home.join(".config");
        }
        PathBuf::from(".config")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_dir_is_non_empty() {
        let dir = get_default_cache_dir();
        assert!(
            dir.as_os_str().len() > 0,
            "cache dir should be non-empty"
        );
    }

    #[test]
    fn config_dir_is_non_empty() {
        let dir = get_default_config_dir();
        assert!(
            dir.as_os_str().len() > 0,
            "config dir should be non-empty"
        );
    }

    #[test]
    fn cache_dir_contains_cache_segment() {
        // On unix the path should end with .cache (unless XDG_CACHE_HOME is set)
        let dir = get_default_cache_dir();
        let dir_str = dir.to_string_lossy();
        assert!(
            dir_str.contains("cache") || dir_str.contains("Cache") || dir_str.contains("Local"),
            "cache dir should reference a cache location: {dir_str}"
        );
    }

    #[test]
    fn config_dir_contains_config_segment() {
        let dir = get_default_config_dir();
        let dir_str = dir.to_string_lossy();
        assert!(
            dir_str.contains("config") || dir_str.contains("Config") || dir_str.contains("Local"),
            "config dir should reference a config location: {dir_str}"
        );
    }
}
