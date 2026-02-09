use std::io;
use std::path::Path;

/// Ensures that a directory exists, creating it and all parent directories
/// if necessary.
pub async fn ensure_dir(path: &Path) -> io::Result<()> {
    tokio::fs::create_dir_all(path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn ensure_dir_creates_nested_directories() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("a").join("b").join("c");

        assert!(!nested.exists());
        ensure_dir(&nested).await.unwrap();
        assert!(nested.exists());
        assert!(nested.is_dir());
    }

    #[tokio::test]
    async fn ensure_dir_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("existing");

        ensure_dir(&target).await.unwrap();
        // Calling again should not fail
        ensure_dir(&target).await.unwrap();
        assert!(target.is_dir());
    }
}
