//! Shared test utilities: mock runners and test data builders.

use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;

use crate::errors::UpdateKitError;
use crate::types::*;
use crate::utils::process::{CommandOutput, CommandRunner};

/// A mock [`CommandRunner`] that returns preconfigured results.
///
/// Responses are keyed by `"{program} {args...}"`. Lookup order:
/// 1. Exact key match
/// 2. Program-only match (no args)
/// 3. Default response
/// 4. `CommandSpawnFailed` error
pub struct MockCommandRunner {
    responses: Mutex<HashMap<String, Result<CommandOutput, String>>>,
    default_response: Mutex<Option<Result<CommandOutput, String>>>,
}

impl MockCommandRunner {
    /// Create an empty mock with no preconfigured responses.
    pub fn new() -> Self {
        Self {
            responses: Mutex::new(HashMap::new()),
            default_response: Mutex::new(None),
        }
    }

    /// Register a response for a given key (e.g. `"echo hello"` or just `"brew"`).
    pub fn on(&self, key: &str, result: Result<CommandOutput, String>) -> &Self {
        self.responses
            .lock()
            .unwrap()
            .insert(key.to_string(), result);
        self
    }

    /// Set a fallback response for any command that does not match a registered key.
    pub fn default_response(&self, result: Result<CommandOutput, String>) -> &Self {
        *self.default_response.lock().unwrap() = Some(result);
        self
    }

    /// Helper: create a successful `CommandOutput` (exit code 0) with the given stdout.
    pub fn success_output(stdout: &str) -> CommandOutput {
        CommandOutput {
            exit_code: Some(0),
            stdout: stdout.to_string(),
            stderr: String::new(),
        }
    }

    /// Helper: create a failed `CommandOutput` (exit code 1) with the given stderr.
    pub fn failure_output(stderr: &str) -> CommandOutput {
        CommandOutput {
            exit_code: Some(1),
            stdout: String::new(),
            stderr: stderr.to_string(),
        }
    }
}

fn resolve_response(
    result: &Result<CommandOutput, String>,
) -> Result<CommandOutput, UpdateKitError> {
    match result {
        Ok(output) => Ok(output.clone()),
        Err(msg) => Err(UpdateKitError::CommandSpawnFailed(msg.clone())),
    }
}

#[async_trait]
impl CommandRunner for MockCommandRunner {
    async fn run(&self, program: &str, args: &[&str]) -> Result<CommandOutput, UpdateKitError> {
        let exact_key = if args.is_empty() {
            program.to_string()
        } else {
            format!("{} {}", program, args.join(" "))
        };

        let responses = self.responses.lock().unwrap();

        // 1. Exact key match
        if let Some(result) = responses.get(&exact_key) {
            return resolve_response(result);
        }

        // 2. Program-only match
        if let Some(result) = responses.get(program) {
            return resolve_response(result);
        }

        drop(responses);

        // 3. Default response
        if let Some(ref result) = *self.default_response.lock().unwrap() {
            return resolve_response(result);
        }

        // 4. No match
        Err(UpdateKitError::CommandSpawnFailed(format!(
            "MockCommandRunner: no response registered for '{}'",
            exact_key
        )))
    }
}

// ── Test data builders ──

/// Create an [`InstallDetection`] with a single piece of test evidence.
pub fn make_detection(channel: Channel, confidence: Confidence) -> InstallDetection {
    InstallDetection {
        channel,
        confidence,
        evidence: vec![Evidence {
            source: "test".into(),
            detail: "test detection".into(),
        }],
    }
}

/// Create an [`UpdateStatus::Available`] with the given current/latest versions.
pub fn make_available(current: &str, latest: &str) -> UpdateStatus {
    UpdateStatus::Available {
        current: current.to_string(),
        latest: latest.to_string(),
        release_url: None,
        release_notes: None,
        assets: None,
    }
}

/// Create an [`UpdateStatus::UpToDate`] with the given version.
pub fn make_up_to_date(version: &str) -> UpdateStatus {
    UpdateStatus::UpToDate {
        current: version.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_runner_exact_key_match() {
        let runner = MockCommandRunner::new();
        runner.on(
            "echo hello",
            Ok(MockCommandRunner::success_output("hello\n")),
        );

        let result = runner.run("echo", &["hello"]).await.unwrap();
        assert!(result.success());
        assert_eq!(result.stdout, "hello\n");
    }

    #[tokio::test]
    async fn mock_runner_program_only_match() {
        let runner = MockCommandRunner::new();
        runner.on(
            "brew",
            Ok(MockCommandRunner::success_output("some-cask\n")),
        );

        let result = runner.run("brew", &["list", "--cask", "foo"]).await.unwrap();
        assert!(result.success());
        assert_eq!(result.stdout, "some-cask\n");
    }

    #[tokio::test]
    async fn mock_runner_default_fallback() {
        let runner = MockCommandRunner::new();
        runner.default_response(Ok(MockCommandRunner::success_output("default\n")));

        let result = runner.run("anything", &["arg1"]).await.unwrap();
        assert!(result.success());
        assert_eq!(result.stdout, "default\n");
    }

    #[tokio::test]
    async fn mock_runner_no_match_returns_error() {
        let runner = MockCommandRunner::new();

        let err = runner.run("missing", &["cmd"]).await.unwrap_err();
        assert_eq!(err.code(), "COMMAND_SPAWN_FAILED");
        assert!(err.to_string().contains("missing cmd"));
    }

    #[test]
    fn mock_runner_success_output_helper() {
        let output = MockCommandRunner::success_output("hello");
        assert_eq!(output.exit_code, Some(0));
        assert_eq!(output.stdout, "hello");
        assert!(output.stderr.is_empty());
        assert!(output.success());
    }

    #[test]
    fn mock_runner_failure_output_helper() {
        let output = MockCommandRunner::failure_output("error occurred");
        assert_eq!(output.exit_code, Some(1));
        assert!(output.stdout.is_empty());
        assert_eq!(output.stderr, "error occurred");
        assert!(!output.success());
    }

    #[test]
    fn make_detection_creates_valid_detection() {
        let det = make_detection(Channel::BrewCask, Confidence::High);
        assert_eq!(det.channel, Channel::BrewCask);
        assert_eq!(det.confidence, Confidence::High);
        assert_eq!(det.evidence.len(), 1);
        assert_eq!(det.evidence[0].source, "test");
    }

    #[test]
    fn make_available_creates_available_status() {
        let status = make_available("1.0.0", "2.0.0");
        match status {
            UpdateStatus::Available {
                current, latest, ..
            } => {
                assert_eq!(current, "1.0.0");
                assert_eq!(latest, "2.0.0");
            }
            _ => panic!("expected Available"),
        }
    }

    #[test]
    fn make_up_to_date_creates_up_to_date_status() {
        let status = make_up_to_date("1.0.0");
        match status {
            UpdateStatus::UpToDate { current } => {
                assert_eq!(current, "1.0.0");
            }
            _ => panic!("expected UpToDate"),
        }
    }
}
