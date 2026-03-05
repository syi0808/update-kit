use crate::types::ApplyProgress;

/// Options for controlling the apply phase.
#[derive(Default)]
pub struct ApplyOptions {
    /// Callback invoked with progress updates during the apply phase.
    pub on_progress: Option<Box<dyn Fn(ApplyProgress) + Send + Sync>>,
    /// Whether to skip checksum verification.
    pub skip_checksum: bool,
}
