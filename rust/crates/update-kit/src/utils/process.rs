use async_trait::async_trait;
use tokio::process::Command;

use crate::errors::UpdateKitError;

/// Output captured from a completed process.
#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl CommandOutput {
    /// Returns `true` if the process exited with code 0.
    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }
}

/// Trait for running external commands, enabling test doubles.
#[async_trait]
pub trait CommandRunner: Send + Sync {
    async fn run(&self, program: &str, args: &[&str]) -> Result<CommandOutput, UpdateKitError>;
}

/// Default implementation backed by `tokio::process::Command`.
#[derive(Debug, Default)]
pub struct TokioCommandRunner;

#[async_trait]
impl CommandRunner for TokioCommandRunner {
    async fn run(&self, program: &str, args: &[&str]) -> Result<CommandOutput, UpdateKitError> {
        let output = Command::new(program)
            .args(args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| {
                UpdateKitError::CommandSpawnFailed(format!(
                    "failed to spawn '{program}': {e}"
                ))
            })?
            .wait_with_output()
            .await
            .map_err(|e| {
                UpdateKitError::CommandSpawnFailed(format!(
                    "failed to collect output from '{program}': {e}"
                ))
            })?;

        Ok(CommandOutput {
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_output_success_true() {
        let output = CommandOutput {
            exit_code: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(output.success());
    }

    #[test]
    fn command_output_success_false_nonzero() {
        let output = CommandOutput {
            exit_code: Some(1),
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(!output.success());
    }

    #[test]
    fn command_output_success_false_none() {
        let output = CommandOutput {
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(!output.success());
    }

    #[tokio::test]
    async fn tokio_runner_runs_echo() {
        let runner = TokioCommandRunner;
        let result = runner.run("echo", &["hello"]).await.unwrap();
        assert!(result.success());
        assert!(result.stdout.contains("hello"));
    }
}
