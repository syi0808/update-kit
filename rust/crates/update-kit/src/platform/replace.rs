use crate::errors::UpdateKitError;
use std::path::Path;

/// Atomically replace the file at `target` with the contents of `source`.
///
/// On Unix: copies source to a temp file next to target, sets executable
/// permissions (0o755), then renames over the target (atomic on the same
/// filesystem). Cleans up the temp file on failure.
///
/// On Windows: renames target to `.old`, copies source to target, then
/// removes the `.old` file. Rolls back on copy failure.
pub async fn atomic_replace(source: &Path, target: &Path) -> Result<(), UpdateKitError> {
    // Check write permission on the target's parent directory
    check_write_permission(target).await?;

    #[cfg(unix)]
    {
        atomic_replace_unix(source, target).await
    }

    #[cfg(windows)]
    {
        atomic_replace_windows(source, target).await
    }
}

async fn check_write_permission(target: &Path) -> Result<(), UpdateKitError> {
    if target.exists() {
        let metadata = tokio::fs::metadata(target).await.map_err(|e| {
            UpdateKitError::PermissionDenied(format!(
                "Cannot access target file {}: {e}",
                target.display()
            ))
        })?;

        // Check if the file is read-only
        if metadata.permissions().readonly() {
            return Err(UpdateKitError::PermissionDenied(format!(
                "Target file is read-only: {}",
                target.display()
            )));
        }
    }
    Ok(())
}

#[cfg(unix)]
async fn atomic_replace_unix(source: &Path, target: &Path) -> Result<(), UpdateKitError> {
    use std::os::unix::fs::PermissionsExt;

    let pid = std::process::id();
    let temp_path = target.with_extension(format!("new.{pid}"));

    // Copy source to temp file
    tokio::fs::copy(source, &temp_path)
        .await
        .map_err(|e| {
            UpdateKitError::ApplyFailed(format!(
                "Failed to copy {} to {}: {e}",
                source.display(),
                temp_path.display()
            ))
        })?;

    // Set executable permissions
    let perms = std::fs::Permissions::from_mode(0o755);
    if let Err(e) = tokio::fs::set_permissions(&temp_path, perms).await {
        // Cleanup temp file on failure
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(UpdateKitError::ApplyFailed(format!(
            "Failed to set permissions on {}: {e}",
            temp_path.display()
        )));
    }

    // Atomic rename
    if let Err(e) = tokio::fs::rename(&temp_path, target).await {
        // Cleanup temp file on failure
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(UpdateKitError::ApplyFailed(format!(
            "Failed to rename {} to {}: {e}",
            temp_path.display(),
            target.display()
        )));
    }

    Ok(())
}

#[cfg(windows)]
async fn atomic_replace_windows(source: &Path, target: &Path) -> Result<(), UpdateKitError> {
    let old_path = target.with_extension("old");

    // Remove any leftover .old file
    let _ = tokio::fs::remove_file(&old_path).await;

    // Rename current target to .old (if target exists)
    if target.exists() {
        tokio::fs::rename(target, &old_path).await.map_err(|e| {
            UpdateKitError::ApplyFailed(format!(
                "Failed to rename {} to {}: {e}",
                target.display(),
                old_path.display()
            ))
        })?;
    }

    // Copy source to target
    if let Err(e) = tokio::fs::copy(source, target).await {
        // Rollback: restore old file
        if old_path.exists() {
            let _ = tokio::fs::rename(&old_path, target).await;
        }
        return Err(UpdateKitError::ApplyFailed(format!(
            "Failed to copy {} to {}: {e}",
            source.display(),
            target.display()
        )));
    }

    // Cleanup .old file
    let _ = tokio::fs::remove_file(&old_path).await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn atomic_replace_success() {
        let dir = TempDir::new().unwrap();

        let target = dir.path().join("myapp");
        let source = dir.path().join("myapp_new");

        // Write initial content
        tokio::fs::write(&target, b"old content").await.unwrap();
        tokio::fs::write(&source, b"new content").await.unwrap();

        // Replace
        atomic_replace(&source, &target).await.unwrap();

        // Verify content changed
        let content = tokio::fs::read_to_string(&target).await.unwrap();
        assert_eq!(content, "new content");
    }

    #[tokio::test]
    async fn replace_creates_target_if_not_exists() {
        let dir = TempDir::new().unwrap();
        let source = dir.path().join("source_bin");
        let target = dir.path().join("new_target");

        tokio::fs::write(&source, b"new binary").await.unwrap();
        // target doesn't exist yet

        let result = atomic_replace(&source, &target).await;
        assert!(result.is_ok());
        let content = tokio::fs::read_to_string(&target).await.unwrap();
        assert_eq!(content, "new binary");
    }

    #[tokio::test]
    async fn replace_preserves_content_exactly() {
        let dir = TempDir::new().unwrap();
        let source = dir.path().join("source");
        let target = dir.path().join("target");

        let data = vec![0u8, 1, 2, 255, 128, 64];
        tokio::fs::write(&source, &data).await.unwrap();
        tokio::fs::write(&target, b"old").await.unwrap();

        atomic_replace(&source, &target).await.unwrap();
        let result = tokio::fs::read(&target).await.unwrap();
        assert_eq!(result, data);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn replace_sets_executable_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        let source = dir.path().join("source");
        let target = dir.path().join("target");

        tokio::fs::write(&source, b"binary").await.unwrap();
        tokio::fs::write(&target, b"old").await.unwrap();

        atomic_replace(&source, &target).await.unwrap();
        let metadata = tokio::fs::metadata(&target).await.unwrap();
        let mode = metadata.permissions().mode();
        assert_eq!(
            mode & 0o777,
            0o755,
            "Expected 755 permissions, got: {mode:o}"
        );
    }

    #[tokio::test]
    async fn replace_source_not_found_fails() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("target");
        tokio::fs::write(&target, b"old").await.unwrap();

        let result = atomic_replace(&dir.path().join("nonexistent"), &target).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn replace_idempotent() {
        let dir = TempDir::new().unwrap();
        let source = dir.path().join("source");
        let target = dir.path().join("target");

        tokio::fs::write(&source, b"content").await.unwrap();
        tokio::fs::write(&target, b"old").await.unwrap();

        atomic_replace(&source, &target).await.unwrap();
        // Create source again (it may have been consumed)
        tokio::fs::write(&source, b"content2").await.unwrap();
        atomic_replace(&source, &target).await.unwrap();
        let content = tokio::fs::read_to_string(&target).await.unwrap();
        assert_eq!(content, "content2");
    }

    #[tokio::test]
    async fn check_write_permission_writable_file() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("writable");
        tokio::fs::write(&target, b"data").await.unwrap();

        let result = check_write_permission(&target).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn check_write_permission_nonexistent_file() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("nonexistent");
        // Non-existent target should be OK (we're creating a new file)
        let result = check_write_permission(&target).await;
        assert!(result.is_ok());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn atomic_replace_no_write_permission() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();

        let target = dir.path().join("readonly_app");
        let source = dir.path().join("new_app");

        tokio::fs::write(&target, b"old").await.unwrap();
        tokio::fs::write(&source, b"new").await.unwrap();

        // Make target read-only
        let perms = std::fs::Permissions::from_mode(0o444);
        tokio::fs::set_permissions(&target, perms).await.unwrap();

        // Should fail with permission denied
        let result = atomic_replace(&source, &target).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, UpdateKitError::PermissionDenied(_)),
            "Expected PermissionDenied, got: {err:?}"
        );
    }
}
