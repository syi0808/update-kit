use std::sync::Arc;

use crate::constants::{DEFAULT_DELEGATE_TIMEOUT_MS, MAX_COMMAND_OUTPUT_BYTES};
use crate::errors::UpdateKitError;
use crate::types::{ApplyProgress, ApplyResult, DelegateMode, PlanKind, UpdatePlan};
use crate::utils::process::{CommandRunner, TokioCommandRunner};

/// Options for delegate command execution.
pub struct DelegateApplyOptions {
    /// Whether to print the command or execute it. Defaults to `PrintOnly`.
    pub mode: Option<DelegateMode>,
    /// Timeout for command execution in milliseconds.
    pub timeout_ms: Option<u64>,
    /// Progress callback.
    pub on_progress: Option<Box<dyn Fn(ApplyProgress) + Send + Sync>>,
    /// Command runner for executing external processes.
    pub cmd: Option<Arc<dyn CommandRunner>>,
}

/// Result of a delegate command operation.
pub struct DelegateApplyResult {
    pub kind: DelegateResultKind,
}

/// The kind of delegate result.
pub enum DelegateResultKind {
    /// Command was only printed, not executed.
    PrintOnly { message: String },
    /// Command was executed.
    Executed {
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
    },
}

/// Safe list of commands that are allowed to be executed.
const COMMAND_SAFELIST: &[&str] = &[
    "npm", "npx", "brew", "apt", "apt-get", "yum", "dnf", "choco", "winget", "scoop",
];

/// Apply an update by delegating to a package manager command.
///
/// In `PrintOnly` mode (default), returns `ApplyResult::NeedsRestart` with the
/// command string. In `Execute` mode, validates the command against a safelist,
/// runs it, and returns success or failure based on exit code.
pub async fn apply_delegate_update(
    plan: &UpdatePlan,
    options: Option<DelegateApplyOptions>,
) -> ApplyResult {
    let (command, mode_from_plan) = match &plan.kind {
        PlanKind::DelegateCommand {
            command, mode, ..
        } => (command.clone(), *mode),
        _ => {
            return ApplyResult::Failed {
                error: Box::new(UpdateKitError::ApplyFailed(
                    "apply_delegate_update called with non-DelegateCommand plan".into(),
                )),
                rollback_succeeded: false,
            };
        }
    };

    let opts_mode = options.as_ref().and_then(|o| o.mode);
    let mode = opts_mode.unwrap_or(mode_from_plan);

    let command_str = command.join(" ");

    match mode {
        DelegateMode::PrintOnly => ApplyResult::NeedsRestart {
            message: format!("Run the following command to update:\n  {command_str}"),
        },
        DelegateMode::Execute => {
            execute_command(&command, &options, &plan.from_version, &plan.to_version).await
        }
    }
}

async fn execute_command(
    command: &[String],
    options: &Option<DelegateApplyOptions>,
    from_version: &str,
    to_version: &str,
) -> ApplyResult {
    if command.is_empty() {
        return ApplyResult::Failed {
            error: Box::new(UpdateKitError::CommandFailed("Empty command".into())),
            rollback_succeeded: false,
        };
    }

    let program = &command[0];

    // Validate against safelist
    if let Err(e) = validate_command(program) {
        return ApplyResult::Failed {
            error: Box::new(e),
            rollback_succeeded: false,
        };
    }

    let timeout_ms = options
        .as_ref()
        .and_then(|o| o.timeout_ms)
        .unwrap_or(DEFAULT_DELEGATE_TIMEOUT_MS);

    let cmd: Arc<dyn CommandRunner> = options
        .as_ref()
        .and_then(|o| o.cmd.clone())
        .unwrap_or_else(|| Arc::new(TokioCommandRunner));

    let progress_cb = options.as_ref().and_then(|o| o.on_progress.as_ref());

    if let Some(cb) = progress_cb {
        cb(ApplyProgress::Executing {
            output: format!("Running: {}", command.join(" ")),
            stream: crate::types::OutputStream::Stdout,
        });
    }

    let args_refs: Vec<&str> = command[1..].iter().map(|s| s.as_str()).collect();

    let result = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        cmd.run(program, &args_refs),
    )
    .await;

    match result {
        Ok(Ok(output)) => {
            let exit_code = output.exit_code;
            let stdout = truncate_string(&output.stdout, MAX_COMMAND_OUTPUT_BYTES);
            let stderr = truncate_string(&output.stderr, MAX_COMMAND_OUTPUT_BYTES);
            // Check for permission errors (npm EACCES)
            if stderr.contains("EACCES") || stderr.contains("permission denied") {
                return ApplyResult::Failed {
                    error: Box::new(UpdateKitError::PermissionDenied(format!(
                        "Permission error running {}: {}",
                        command.join(" "),
                        stderr.lines().next().unwrap_or(&stderr)
                    ))),
                    rollback_succeeded: false,
                };
            }

            match exit_code {
                Some(0) => ApplyResult::Success {
                    from_version: from_version.to_string(),
                    to_version: to_version.to_string(),
                    post_action: crate::types::PostAction::SuggestRestart,
                },
                _ => ApplyResult::Failed {
                    error: Box::new(UpdateKitError::CommandFailed(format!(
                        "Command exited with code {:?}: {}",
                        exit_code,
                        if stderr.is_empty() { &stdout } else { &stderr }
                    ))),
                    rollback_succeeded: false,
                },
            }
        }
        Ok(Err(e)) => ApplyResult::Failed {
            error: Box::new(e),
            rollback_succeeded: false,
        },
        Err(_) => ApplyResult::Failed {
            error: Box::new(UpdateKitError::CommandTimeout(timeout_ms)),
            rollback_succeeded: false,
        },
    }
}

fn truncate_string(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        s.to_string()
    } else {
        s[..max_bytes].to_string()
    }
}

/// Validate that a command program is in the allowed safelist.
pub fn validate_command(program: &str) -> Result<(), UpdateKitError> {
    // Extract just the binary name (strip path)
    let binary_name = program.rsplit('/').next().unwrap_or(program);
    let binary_name = binary_name.rsplit('\\').next().unwrap_or(binary_name);

    if COMMAND_SAFELIST.contains(&binary_name) {
        Ok(())
    } else {
        Err(UpdateKitError::CommandFailed(format!(
            "Command '{binary_name}' is not in the allowed safelist: {:?}",
            COMMAND_SAFELIST
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Channel, PostAction};

    fn make_delegate_plan(command: Vec<&str>, mode: DelegateMode) -> UpdatePlan {
        UpdatePlan {
            kind: PlanKind::DelegateCommand {
                channel: Channel::NpmGlobal,
                command: command.into_iter().map(String::from).collect(),
                mode,
            },
            from_version: "1.0.0".into(),
            to_version: "2.0.0".into(),
            post_action: PostAction::SuggestRestart,
        }
    }

    #[tokio::test]
    async fn print_only_mode_returns_needs_restart() {
        let plan = make_delegate_plan(vec!["npm", "update", "-g", "myapp"], DelegateMode::PrintOnly);

        let result = apply_delegate_update(&plan, None).await;
        match result {
            ApplyResult::NeedsRestart { message } => {
                assert!(message.contains("npm update -g myapp"));
            }
            other => panic!("Expected NeedsRestart, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn invalid_command_rejected() {
        let plan = make_delegate_plan(vec!["rm", "-rf", "/"], DelegateMode::Execute);

        let result = apply_delegate_update(&plan, None).await;
        match result {
            ApplyResult::Failed { error, .. } => {
                assert_eq!(error.code(), "COMMAND_FAILED");
                assert!(error.to_string().contains("safelist"));
            }
            other => panic!("Expected Failed, got: {other:?}"),
        }
    }

    #[test]
    fn safelist_validation_accepts_valid_commands() {
        assert!(validate_command("npm").is_ok());
        assert!(validate_command("brew").is_ok());
        assert!(validate_command("apt-get").is_ok());
        assert!(validate_command("choco").is_ok());
        assert!(validate_command("winget").is_ok());
        assert!(validate_command("scoop").is_ok());
    }

    #[test]
    fn safelist_validation_rejects_invalid_commands() {
        assert!(validate_command("rm").is_err());
        assert!(validate_command("curl").is_err());
        assert!(validate_command("sudo").is_err());
        assert!(validate_command("sh").is_err());
    }

    #[test]
    fn safelist_validation_strips_path() {
        assert!(validate_command("/usr/bin/npm").is_ok());
        assert!(validate_command("/usr/local/bin/brew").is_ok());
    }

    #[tokio::test]
    async fn wrong_plan_type_fails() {
        let plan = UpdatePlan {
            kind: PlanKind::ManualInstall {
                reason: "test".into(),
                instructions: "test".into(),
                download_url: None,
            },
            from_version: "1.0.0".into(),
            to_version: "2.0.0".into(),
            post_action: PostAction::None,
        };

        let result = apply_delegate_update(&plan, None).await;
        match result {
            ApplyResult::Failed { error, .. } => {
                assert_eq!(error.code(), "APPLY_FAILED");
            }
            other => panic!("Expected Failed, got: {other:?}"),
        }
    }
}
