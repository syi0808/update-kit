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
}
