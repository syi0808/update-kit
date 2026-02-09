use std::path::Path;
use std::process::Command;

use crate::errors::UpdateKitError;

/// Spawn a background process to check for updates.
///
/// Launches the current executable (or the given exe) as a detached process
/// with a special flag and serialized config JSON. The process runs
/// independently (fire and forget).
pub fn spawn_background_check(exe_path: &Path, config_json: &str) -> Result<(), UpdateKitError> {
    let exe = exe_path.to_str().ok_or_else(|| {
        UpdateKitError::CommandSpawnFailed("Invalid executable path".into())
    })?;

    let mut cmd = Command::new(exe);
    cmd.arg("--update-kit-background-check")
        .arg(config_json)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // On Unix, use process group detachment
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    // On Windows, use creation flags for detached process
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| {
        UpdateKitError::CommandSpawnFailed(format!(
            "Failed to spawn background check: {}",
            e
        ))
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_spawn_background_check_nonexistent_exe() {
        let result = spawn_background_check(
            &PathBuf::from("/nonexistent/binary"),
            "{}",
        );
        assert!(result.is_err());
    }

    #[test]
    fn spawn_with_current_exe_succeeds() {
        // Use the test binary itself — it will exit quickly since args won't match
        let exe = std::env::current_exe().unwrap();
        let result = spawn_background_check(&exe, "{}");
        assert!(result.is_ok());
    }

    #[test]
    fn spawn_with_complex_config_json() {
        let exe = std::env::current_exe().unwrap();
        let config = r#"{"app_name":"test","version":"1.0.0","sources":[]}"#;
        let result = spawn_background_check(&exe, config);
        assert!(result.is_ok());
    }

    #[test]
    fn spawn_with_empty_config() {
        let exe = std::env::current_exe().unwrap();
        let result = spawn_background_check(&exe, "");
        assert!(result.is_ok()); // Empty string is valid as argument
    }

    #[test]
    fn spawn_with_special_chars_in_config() {
        let exe = std::env::current_exe().unwrap();
        let config = r#"{"name":"test \"quoted\" & special <chars>"}"#;
        let result = spawn_background_check(&exe, config);
        assert!(result.is_ok());
    }
}
