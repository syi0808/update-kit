use std::path::{Path, PathBuf};

use tokio::io::AsyncWriteExt;

use crate::applier::types::ApplyOptions;
use crate::applier::verify::{verify_checksum, ChecksumInfo, VerifyOptions};
use crate::errors::UpdateKitError;
use crate::platform::replace::atomic_replace;
use crate::types::{ApplyProgress, ApplyResult, PlanKind, UpdatePlan};
use crate::utils::http::fetch_with_timeout;
use crate::utils::security::require_https;

/// Apply a native in-place update by downloading, verifying, extracting,
/// and atomically replacing the target binary.
pub async fn apply_native_update(
    plan: &UpdatePlan,
    target_path: &str,
    options: Option<&ApplyOptions>,
) -> ApplyResult {
    let (download_url, checksum_url, expected_checksum) = match &plan.kind {
        PlanKind::NativeInPlace {
            download_url,
            checksum_url,
            expected_checksum,
        } => (
            download_url.as_str(),
            checksum_url.clone(),
            expected_checksum.clone(),
        ),
        _ => {
            return ApplyResult::Failed {
                error: Box::new(UpdateKitError::ApplyFailed(
                    "apply_native_update called with non-NativeInPlace plan".into(),
                )),
                rollback_succeeded: false,
            };
        }
    };

    let target = Path::new(target_path);
    let parent = target.parent().unwrap_or(Path::new("."));

    // Create temp dir in the same parent directory for same-filesystem operations
    let temp_dir = match tempfile::tempdir_in(parent) {
        Ok(d) => d,
        Err(e) => {
            return ApplyResult::Failed {
                error: Box::new(UpdateKitError::ApplyFailed(format!(
                    "Failed to create temp directory: {e}"
                ))),
                rollback_succeeded: false,
            };
        }
    };

    let progress_cb = options.and_then(|o| o.on_progress.as_deref());
    let skip_checksum = options.is_some_and(|o| o.skip_checksum);

    // Step 1: Download
    let archive_path = match download_artifact(download_url, temp_dir.path(), progress_cb).await {
        Ok(p) => p,
        Err(e) => {
            return ApplyResult::Failed {
                error: Box::new(e),
                rollback_succeeded: false,
            };
        }
    };

    // Step 2: Verify checksum
    if !skip_checksum {
        if let Some(cb) = progress_cb {
            cb(ApplyProgress::Verifying);
        }

        let checksum_info = ChecksumInfo {
            expected_checksum,
            checksum_url,
        };

        let verify_opts = VerifyOptions {
            filename: archive_path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned()),
        };

        if let Err(e) = verify_checksum(&archive_path, &checksum_info, Some(&verify_opts)).await {
            return ApplyResult::Failed {
                error: Box::new(e),
                rollback_succeeded: false,
            };
        }
    }

    // Step 3: Extract
    if let Some(cb) = progress_cb {
        cb(ApplyProgress::Extracting);
    }

    let extract_dir = temp_dir.path().join("extracted");
    if let Err(e) = tokio::fs::create_dir_all(&extract_dir).await {
        return ApplyResult::Failed {
            error: Box::new(UpdateKitError::ExtractFailed(format!(
                "Failed to create extraction directory: {e}"
            ))),
            rollback_succeeded: false,
        };
    }

    let binary_path = match extract_binary(&archive_path, &extract_dir).await {
        Ok(p) => p,
        Err(e) => {
            return ApplyResult::Failed {
                error: Box::new(e),
                rollback_succeeded: false,
            };
        }
    };

    // Step 4: Atomic replace
    if let Some(cb) = progress_cb {
        cb(ApplyProgress::Replacing);
    }

    if let Err(e) = atomic_replace(&binary_path, target).await {
        return ApplyResult::Failed {
            error: Box::new(e),
            rollback_succeeded: false,
        };
    }

    // temp_dir is dropped here, cleaning up automatically

    if let Some(cb) = progress_cb {
        cb(ApplyProgress::Done);
    }

    ApplyResult::Success {
        from_version: plan.from_version.clone(),
        to_version: plan.to_version.clone(),
        post_action: plan.post_action,
    }
}

/// Download an artifact from a URL to a destination directory.
/// Returns the path to the downloaded file.
async fn download_artifact(
    url: &str,
    dest_dir: &Path,
    on_progress: Option<&(dyn Fn(ApplyProgress) + Send + Sync)>,
) -> Result<PathBuf, UpdateKitError> {
    require_https(url)?;

    let response = fetch_with_timeout(url, None).await?;

    let total_bytes = response.content_length();

    // Derive filename from URL
    let filename = url
        .rsplit('/')
        .next()
        .unwrap_or("download")
        .split('?')
        .next()
        .unwrap_or("download");

    let dest_path = dest_dir.join(filename);
    let mut file = tokio::fs::File::create(&dest_path).await.map_err(|e| {
        UpdateKitError::DownloadFailed(format!("Failed to create download file: {e}"))
    })?;

    let mut bytes_downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            UpdateKitError::DownloadFailed(format!("Error reading download stream: {e}"))
        })?;
        file.write_all(&chunk).await.map_err(|e| {
            UpdateKitError::DownloadFailed(format!("Error writing download data: {e}"))
        })?;

        bytes_downloaded += chunk.len() as u64;

        if let Some(cb) = on_progress {
            cb(ApplyProgress::Downloading {
                bytes_downloaded,
                total_bytes,
            });
        }
    }

    file.flush().await.map_err(|e| {
        UpdateKitError::DownloadFailed(format!("Error flushing download file: {e}"))
    })?;

    Ok(dest_path)
}

/// Extract a binary from an archive file. Returns the path to the extracted binary.
///
/// Supports `.tar.gz`, `.tgz`, `.zip`, and bare binaries.
pub async fn extract_binary(
    archive_path: &Path,
    dest_dir: &Path,
) -> Result<PathBuf, UpdateKitError> {
    let filename = archive_path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if filename.ends_with(".tar.gz") || filename.ends_with(".tgz") {
        extract_tar_gz(archive_path, dest_dir).await?;
    } else if filename.ends_with(".zip") {
        extract_zip(archive_path, dest_dir).await?;
    } else {
        // Treat as bare binary
        let dest = dest_dir.join(
            archive_path
                .file_name()
                .unwrap_or(std::ffi::OsStr::new("binary")),
        );
        tokio::fs::copy(archive_path, &dest).await.map_err(|e| {
            UpdateKitError::ExtractFailed(format!("Failed to copy bare binary: {e}"))
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o755);
            tokio::fs::set_permissions(&dest, perms).await.ok();
        }

        return Ok(dest);
    }

    find_binary_in_dir(dest_dir).await
}

async fn extract_tar_gz(archive_path: &Path, dest_dir: &Path) -> Result<(), UpdateKitError> {
    let archive_path = archive_path.to_owned();
    let dest_dir = dest_dir.to_owned();

    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&archive_path).map_err(|e| {
            UpdateKitError::ExtractFailed(format!("Failed to open archive: {e}"))
        })?;

        let gz = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);

        archive.unpack(&dest_dir).map_err(|e| {
            UpdateKitError::ExtractFailed(format!("Failed to extract tar.gz: {e}"))
        })?;

        Ok(())
    })
    .await
    .map_err(|e| UpdateKitError::ExtractFailed(format!("Task join error: {e}")))?
}

async fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<(), UpdateKitError> {
    let archive_path = archive_path.to_owned();
    let dest_dir = dest_dir.to_owned();

    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&archive_path).map_err(|e| {
            UpdateKitError::ExtractFailed(format!("Failed to open archive: {e}"))
        })?;

        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            UpdateKitError::ExtractFailed(format!("Failed to read zip archive: {e}"))
        })?;

        archive.extract(&dest_dir).map_err(|e| {
            UpdateKitError::ExtractFailed(format!("Failed to extract zip: {e}"))
        })?;

        Ok(())
    })
    .await
    .map_err(|e| UpdateKitError::ExtractFailed(format!("Task join error: {e}")))?
}

/// Find the first executable file in a directory (recursively).
pub fn find_binary_in_dir(
    dir: &Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<PathBuf, UpdateKitError>> + Send + '_>> {
    Box::pin(find_binary_in_dir_inner(dir))
}

async fn find_binary_in_dir_inner(dir: &Path) -> Result<PathBuf, UpdateKitError> {
    let mut entries = tokio::fs::read_dir(dir)
        .await
        .map_err(|e| UpdateKitError::ExtractFailed(format!("Failed to read directory: {e}")))?;

    let mut candidates: Vec<PathBuf> = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| UpdateKitError::ExtractFailed(format!("Failed to read dir entry: {e}")))?
    {
        let path = entry.path();
        let metadata = tokio::fs::metadata(&path).await.map_err(|e| {
            UpdateKitError::ExtractFailed(format!("Failed to read metadata: {e}"))
        })?;

        if metadata.is_dir() {
            // Recurse into subdirectories
            if let Ok(found) = find_binary_in_dir(&path).await {
                candidates.push(found);
            }
        } else if metadata.is_file() && is_executable(&path, &metadata) {
            candidates.push(path);
        }
    }

    // Prefer files without common non-binary extensions
    candidates.sort_by(|a, b| {
        let a_ext = a.extension().map(|e| e.to_string_lossy().to_lowercase());
        let b_ext = b.extension().map(|e| e.to_string_lossy().to_lowercase());
        let a_is_archive = matches!(a_ext.as_deref(), Some("gz" | "zip" | "tar" | "tgz"));
        let b_is_archive = matches!(b_ext.as_deref(), Some("gz" | "zip" | "tar" | "tgz"));
        a_is_archive.cmp(&b_is_archive)
    });

    candidates.first().cloned().ok_or_else(|| {
        UpdateKitError::ExtractFailed(format!(
            "No executable binary found in {}",
            dir.display()
        ))
    })
}

fn is_executable(_path: &Path, metadata: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        mode & 0o111 != 0
    }

    #[cfg(windows)]
    {
        // On Windows, check for common executable extensions
        let ext = _path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());
        matches!(ext.as_deref(), Some("exe" | "cmd" | "bat" | "com"))
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = _path;
        let _ = metadata;
        true
    }
}

/// Detect archive type from filename.
pub fn detect_archive_type(filename: &str) -> ArchiveType {
    let lower = filename.to_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        ArchiveType::TarGz
    } else if lower.ends_with(".zip") {
        ArchiveType::Zip
    } else {
        ArchiveType::Bare
    }
}

/// The type of archive format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveType {
    TarGz,
    Zip,
    Bare,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_detect_archive_type_tar_gz() {
        assert_eq!(detect_archive_type("app-v1.tar.gz"), ArchiveType::TarGz);
        assert_eq!(detect_archive_type("app-v1.tgz"), ArchiveType::TarGz);
        assert_eq!(detect_archive_type("APP.TAR.GZ"), ArchiveType::TarGz);
    }

    #[test]
    fn test_detect_archive_type_zip() {
        assert_eq!(detect_archive_type("app-v1.zip"), ArchiveType::Zip);
        assert_eq!(detect_archive_type("APP.ZIP"), ArchiveType::Zip);
    }

    #[test]
    fn test_detect_archive_type_bare() {
        assert_eq!(detect_archive_type("app"), ArchiveType::Bare);
        assert_eq!(detect_archive_type("app.exe"), ArchiveType::Bare);
    }

    #[tokio::test]
    async fn test_extract_bare_binary() {
        let dir = TempDir::new().unwrap();
        let archive_path = dir.path().join("myapp");
        let extract_dir = dir.path().join("extracted");
        tokio::fs::create_dir_all(&extract_dir).await.unwrap();
        tokio::fs::write(&archive_path, b"fake binary content")
            .await
            .unwrap();

        let result = extract_binary(&archive_path, &extract_dir).await;
        assert!(result.is_ok());
        let binary = result.unwrap();
        assert!(binary.exists());
        let content = tokio::fs::read_to_string(&binary).await.unwrap();
        assert_eq!(content, "fake binary content");
    }

    #[tokio::test]
    async fn test_extract_tar_gz() {
        let dir = TempDir::new().unwrap();
        let archive_path = dir.path().join("test.tar.gz");
        let extract_dir = dir.path().join("extracted");
        tokio::fs::create_dir_all(&extract_dir).await.unwrap();

        // Create a tar.gz archive with a binary inside
        {
            let file = std::fs::File::create(&archive_path).unwrap();
            let gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
            let mut tar_builder = tar::Builder::new(gz);

            let content = b"#!/bin/sh\necho hello";
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            tar_builder
                .append_data(&mut header, "myapp", &content[..])
                .unwrap();
            tar_builder.finish().unwrap();
        }

        let result = extract_binary(&archive_path, &extract_dir).await;
        assert!(result.is_ok());
        let binary = result.unwrap();
        let content = tokio::fs::read_to_string(&binary).await.unwrap();
        assert_eq!(content, "#!/bin/sh\necho hello");
    }

    #[tokio::test]
    async fn test_extract_zip() {
        let dir = TempDir::new().unwrap();
        let archive_path = dir.path().join("test.zip");
        let extract_dir = dir.path().join("extracted");
        tokio::fs::create_dir_all(&extract_dir).await.unwrap();

        // Create a zip archive with a file inside
        {
            let file = std::fs::File::create(&archive_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default()
                .unix_permissions(0o755);
            zip.start_file("myapp", options).unwrap();
            use std::io::Write;
            zip.write_all(b"binary content").unwrap();
            zip.finish().unwrap();
        }

        let result = extract_binary(&archive_path, &extract_dir).await;
        assert!(result.is_ok());
        let binary = result.unwrap();
        let content = tokio::fs::read_to_string(&binary).await.unwrap();
        assert_eq!(content, "binary content");
    }

    #[tokio::test]
    async fn test_find_binary_in_dir_empty() {
        let dir = TempDir::new().unwrap();
        let result = find_binary_in_dir(dir.path()).await;
        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_find_binary_in_dir_with_executable() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        let bin_path = dir.path().join("myapp");
        tokio::fs::write(&bin_path, b"binary").await.unwrap();
        tokio::fs::set_permissions(&bin_path, std::fs::Permissions::from_mode(0o755))
            .await
            .unwrap();

        let result = find_binary_in_dir(dir.path()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), bin_path);
    }
}
