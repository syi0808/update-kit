import { spawn } from "node:child_process";
import {
  DEFAULT_DELEGATE_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
} from "../constants.js";
import {
  COMMAND_ABORTED,
  COMMAND_FAILED,
  COMMAND_SPAWN_FAILED,
  COMMAND_TIMEOUT,
  PERMISSION_DENIED,
  UpdateKitError,
} from "../errors.js";
import type { PostAction, UpdatePlan } from "../types.js";
import type { DelegateApplyOptions, DelegateApplyResult } from "./types.js";

const ALLOWED_COMMANDS = new Set([
  "npm",
  "npx",
  "brew",
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "choco",
  "winget",
  "scoop",
]);

/**
 * Apply a delegate-command update: either print the command or execute it.
 *
 * @param plan - Update plan with kind.type === 'delegate-command'.
 * @param options - Mode, timeout, progress callback, AbortSignal.
 */
export async function applyDelegateUpdate(
  plan: UpdatePlan,
  options: DelegateApplyOptions = {},
): Promise<DelegateApplyResult> {
  if (plan.kind.type !== "delegate-command") {
    throw new UpdateKitError(
      COMMAND_FAILED,
      `applyDelegateUpdate requires a delegate-command plan, got: ${plan.kind.type}`,
    );
  }

  const { command } = plan.kind;
  const mode = options.mode ?? plan.kind.mode ?? "print-only";

  validateCommand(command);

  if (mode === "print-only") {
    return applyPrintOnly(plan, command);
  }

  return applyExecute(plan, command, plan.postAction, options);
}

function validateCommand(command: string[]): void {
  if (command.length === 0) {
    throw new UpdateKitError(COMMAND_FAILED, "Empty command.");
  }

  const baseCommand = command[0];
  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    throw new UpdateKitError(
      COMMAND_FAILED,
      `Disallowed command: ${baseCommand}. Allowed: ${[...ALLOWED_COMMANDS].join(", ")}`,
    );
  }
}

function applyPrintOnly(
  plan: UpdatePlan,
  command: string[],
): DelegateApplyResult {
  const commandStr = command.join(" ");

  return {
    kind: "success",
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    postAction: plan.postAction,
    command,
    message: `Run the following command to update:\n\n  ${commandStr}`,
  };
}

async function applyExecute(
  plan: UpdatePlan,
  command: string[],
  postAction: PostAction,
  options: DelegateApplyOptions,
): Promise<DelegateApplyResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DELEGATE_TIMEOUT_MS;
  const { onProgress, signal } = options;

  return new Promise((resolve, reject) => {
    const commandStr = command.join(" ");
    const [cmd, ...args] = command;

    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle(() =>
        reject(
          new UpdateKitError(
            COMMAND_TIMEOUT,
            `Command timed out (${timeoutMs}ms): ${commandStr}`,
          ),
        ),
      );
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
        clearTimeout(timer);
        settle(() =>
          reject(
            new UpdateKitError(COMMAND_ABORTED, "Command execution aborted."),
          ),
        );
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          child.kill("SIGTERM");
          clearTimeout(timer);
          settle(() =>
            reject(
              new UpdateKitError(COMMAND_ABORTED, "Command execution aborted."),
            ),
          );
        },
        { once: true },
      );
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (stdout.length < MAX_COMMAND_OUTPUT_BYTES) {
        stdout += text;
      }
      onProgress?.({
        phase: "executing",
        output: text,
        stream: "stdout",
      });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (stderr.length < MAX_COMMAND_OUTPUT_BYTES) {
        stderr += text;
      }
      onProgress?.({
        phase: "executing",
        output: text,
        stream: "stderr",
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      settle(() => {
        try {
          const result = normalizeResult(
            exitCode ?? 1,
            stdout,
            stderr,
            command,
            plan,
            postAction,
          );
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      settle(() =>
        reject(
          new UpdateKitError(
            COMMAND_SPAWN_FAILED,
            `Command spawn failed: ${error.message}`,
          ),
        ),
      );
    });
  });
}

function normalizeResult(
  exitCode: number,
  stdout: string,
  stderr: string,
  command: string[],
  plan: UpdatePlan,
  postAction: PostAction,
): DelegateApplyResult {
  const commandStr = command.join(" ");

  if (exitCode === 0) {
    return {
      kind: "success",
      postAction,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      command,
      stdout,
      stderr,
    };
  }

  if (isNpmPermissionError(stderr)) {
    throw new UpdateKitError(
      PERMISSION_DENIED,
      `npm permission error. Run with appropriate permissions.\nCommand: ${commandStr}`,
    );
  }

  if (isBrewAlreadyInstalled(stdout, stderr)) {
    return {
      kind: "success",
      postAction,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      command,
      stdout,
      stderr,
    };
  }

  throw new UpdateKitError(
    COMMAND_FAILED,
    `Command failed (exit code ${exitCode}): ${commandStr}\n${stderr}`.trim(),
  );
}

function isNpmPermissionError(stderr: string): boolean {
  return (
    stderr.includes("EACCES") ||
    stderr.includes("permission denied") ||
    stderr.includes("Missing write access")
  );
}

function isBrewAlreadyInstalled(stdout: string, stderr: string): boolean {
  const combined = stdout + stderr;
  return (
    combined.includes("already installed") ||
    combined.includes("already up-to-date") ||
    combined.includes("is already the latest version")
  );
}
