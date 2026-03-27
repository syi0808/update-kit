import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export interface TestEnvironment {
  tmpDir: string;
  binDir: string;
  appDir: string;
  cachePath: string;
  executablePath: string;
  configPath: string;
  callLogPath: string;
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

export type ChannelType = "native" | "npm-global" | "brew-cask" | "unmanaged" | "apt" | "choco" | "custom";

export interface MockBinBehavior {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  delayMs?: number;
}

export interface CreateTestEnvironmentOptions {
  channel: ChannelType;
  currentVersion?: string;
  appName?: string;
  configOverrides?: Record<string, unknown>;
  mockBinBehavior?: Record<string, MockBinBehavior>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MOCK_COMMAND_SRC = path.resolve(__dirname, "mock-command.sh");

const DUMMY_BINARY = '#!/bin/sh\necho "test-app v1.0.0"\n';

export async function createTestEnvironment(
  options: CreateTestEnvironmentOptions,
): Promise<TestEnvironment> {
  const {
    channel,
    currentVersion = "1.0.0",
    appName = "test-app",
    configOverrides = {},
    mockBinBehavior = {},
  } = options;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `e2e-${channel}-`));
  const binDir = path.join(tmpDir, "bins");
  const cacheDir = path.join(tmpDir, "cache");
  const configDir = path.join(tmpDir, ".config");

  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });

  // Set up mock binaries
  const mockSrc = await fs.readFile(MOCK_COMMAND_SRC, "utf-8");
  const binNames = ["brew", "npm", "npx", "apt", "apt-get", "yum", "dnf", "choco", "winget", "scoop"];
  for (const bin of binNames) {
    const binPath = path.join(binDir, bin);
    await fs.writeFile(binPath, mockSrc, { mode: 0o755 });
  }

  const callLogPath = path.join(tmpDir, "call.log");

  let executablePath: string;
  let appDir: string;

  switch (channel) {
    case "native": {
      appDir = path.join(tmpDir, "app");
      await fs.mkdir(appDir, { recursive: true });
      executablePath = path.join(appDir, appName);
      await fs.writeFile(executablePath, DUMMY_BINARY, { mode: 0o755 });

      // Write install receipt at ~/.config/{appName}/install-receipt.json
      // detectFromReceipt uses homedir()/.config/{appName}
      const receiptDir = path.join(configDir, appName);
      await fs.mkdir(receiptDir, { recursive: true });
      await fs.writeFile(
        path.join(receiptDir, "install-receipt.json"),
        JSON.stringify({ appName, channel: "native", version: currentVersion }),
      );
      break;
    }
    case "npm-global": {
      appDir = path.join(tmpDir, "lib");
      const nodeModulesDir = path.join(appDir, "node_modules", appName);
      const binLinkDir = path.join(appDir, "node_modules", ".bin");
      await fs.mkdir(nodeModulesDir, { recursive: true });
      await fs.mkdir(binLinkDir, { recursive: true });

      const realBin = path.join(nodeModulesDir, "bin", appName);
      await fs.mkdir(path.dirname(realBin), { recursive: true });
      await fs.writeFile(realBin, DUMMY_BINARY, { mode: 0o755 });

      executablePath = path.join(binLinkDir, appName);
      await fs.symlink(realBin, executablePath);

      if (!mockBinBehavior.npm) {
        mockBinBehavior.npm = { stdout: appDir };
      }
      break;
    }
    case "brew-cask": {
      appDir = path.join(tmpDir, "opt", "homebrew", "bin");
      await fs.mkdir(appDir, { recursive: true });
      executablePath = path.join(appDir, appName);
      await fs.writeFile(executablePath, DUMMY_BINARY, { mode: 0o755 });

      if (!mockBinBehavior.brew) {
        mockBinBehavior.brew = { exitCode: 0, stdout: appName };
      }
      break;
    }
    case "unmanaged":
    default: {
      appDir = path.join(tmpDir, "somewhere");
      await fs.mkdir(appDir, { recursive: true });
      executablePath = path.join(appDir, appName);
      await fs.writeFile(executablePath, DUMMY_BINARY, { mode: 0o755 });
      break;
    }
  }

  const env: Record<string, string> = {
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    HOME: tmpDir,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
    MOCK_CALL_LOG: callLogPath,
    MOCK_EXIT_CODE: "0",
    MOCK_STDOUT: "",
    MOCK_STDERR: "",
  };

  const primaryBin = getPrimaryBin(channel);
  if (primaryBin && mockBinBehavior[primaryBin]) {
    const b = mockBinBehavior[primaryBin];
    if (b.exitCode !== undefined) env.MOCK_EXIT_CODE = String(b.exitCode);
    if (b.stdout !== undefined) env.MOCK_STDOUT = b.stdout;
    if (b.stderr !== undefined) env.MOCK_STDERR = b.stderr;
    if (b.delayMs !== undefined) env.MOCK_DELAY_MS = String(b.delayMs);
  }

  const config = {
    appName,
    currentVersion,
    executablePath,
    cacheDir,
    sources: [{ type: "github", owner: "test-org", repo: appName }],
    ...(channel === "npm-global" ? { npmPackageName: appName } : {}),
    ...(channel === "brew-cask" ? { brewCaskName: appName } : {}),
    ...configOverrides,
  };

  const configPath = path.join(tmpDir, "update-kit.config.json");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  // Set process.env.HOME so that in-process API tests pick up the
  // receipt file (detectFromReceipt uses homedir()/.config/{appName}).
  // Safe because pool: 'forks' runs each test file in its own process.
  const originalHome = process.env.HOME;
  process.env.HOME = tmpDir;

  return {
    tmpDir,
    binDir,
    appDir,
    cachePath: cacheDir,
    executablePath,
    configPath,
    callLogPath,
    env,
    async cleanup() {
      process.env.HOME = originalHome;
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

function getPrimaryBin(channel: ChannelType): string | null {
  switch (channel) {
    case "npm-global": return "npm";
    case "brew-cask": return "brew";
    case "apt": return "apt";
    case "choco": return "choco";
    default: return null;
  }
}
