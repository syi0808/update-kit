import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestEnvironment } from "./environment.js";

export interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCLIOptions {
  args: string[];
  env: TestEnvironment;
  timeout?: number;
  fetchMockDir?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../../../dist/cli.mjs");
const BOOTSTRAP_PATH = path.resolve(__dirname, "cli-bootstrap.mjs");

export function runCLI(options: RunCLIOptions): Promise<CLIResult> {
  const { args, env, timeout = 10_000, fetchMockDir } = options;

  return new Promise((resolve, reject) => {
    const childEnv = {
      ...env.env,
      NODE_NO_WARNINGS: "1",
      ...(fetchMockDir ? { FETCH_MOCK_DIR: fetchMockDir } : {}),
    };

    const child = spawn(
      process.execPath,
      ["--import", BOOTSTRAP_PATH, CLI_PATH, ...args],
      {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
