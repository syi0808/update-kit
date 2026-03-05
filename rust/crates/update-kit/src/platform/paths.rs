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

    #[cfg(not(windows))]
    #[test]
    fn cache_dir_respects_xdg_cache_home() {
        let original = std::env::var("XDG_CACHE_HOME").ok();
        std::env::set_var("XDG_CACHE_HOME", "/tmp/test-xdg-cache");
        let dir = get_default_cache_dir();
        assert_eq!(dir, PathBuf::from("/tmp/test-xdg-cache"));
        match original {
            Some(v) => std::env::set_var("XDG_CACHE_HOME", v),
            None => std::env::remove_var("XDG_CACHE_HOME"),
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn config_dir_respects_xdg_config_home() {
        let original = std::env::var("XDG_CONFIG_HOME").ok();
        std::env::set_var("XDG_CONFIG_HOME", "/tmp/test-xdg-config");
        let dir = get_default_config_dir();
        assert_eq!(dir, PathBuf::from("/tmp/test-xdg-config"));
        match original {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
    }

    #[test]
    fn cache_and_config_dirs_are_different() {
        let cache = get_default_cache_dir();
        let config = get_default_config_dir();
        assert!(cache.as_os_str().len() > 0);
        assert!(config.as_os_str().len() > 0);
        // On most systems they should be different (unless Windows defaults)
        if !cfg!(windows) {
            assert_ne!(cache, config, "Cache and config dirs should differ on Unix");
        }
    }

    #[test]
    fn dirs_are_absolute_or_relative_fallback() {
        let cache = get_default_cache_dir();
        let config = get_default_config_dir();
        // With HOME set, dirs should be absolute. Without HOME, they'd be relative fallbacks.
        // Just verify they don't panic and return something.
        let _ = cache.to_string_lossy();
        let _ = config.to_string_lossy();
    }
}
