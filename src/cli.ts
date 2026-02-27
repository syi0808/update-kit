#!/usr/bin/env node

import { UpdateKit } from './index.js';
import type { UpdateKitConfig, UpdateKitExplicitConfig } from './config.js';
import { readCache, clearCache } from './checker/cache.js';
import { getDefaultCacheDir } from './platform/paths.js';
import { runDoctor } from './doctor.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Arg Parsing ───

interface ParsedArgs {
  command: string;
  subcommand?: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith('--') ? args[0] : 'help';
  const subcommand =
    args[1] && !args[1].startsWith('--') ? args[1] : undefined;

  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  return { command, subcommand, flags };
}

// ─── Config Loading ───

function loadConfig(configPath?: string): UpdateKitExplicitConfig {
  const resolvedPath = configPath
    ? resolve(configPath)
    : resolve(process.cwd(), 'update-kit.config.json');

  if (!existsSync(resolvedPath)) {
    console.error(`Config file not found: ${resolvedPath}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf-8');
  } catch (error) {
    console.error(
      `Failed to read config file: ${resolvedPath}\n${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      `Invalid JSON in config file: ${resolvedPath}\n${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.error(`Config must be a JSON object: ${resolvedPath}`);
    process.exit(1);
  }

  const config = parsed as Record<string, unknown>;

  if (typeof config['appName'] !== 'string' || config['appName'].length === 0) {
    console.error(`Config missing required field "appName" (string): ${resolvedPath}`);
    process.exit(1);
  }

  if (typeof config['currentVersion'] !== 'string' || config['currentVersion'].length === 0) {
    console.error(`Config missing required field "currentVersion" (string): ${resolvedPath}`);
    process.exit(1);
  }

  return config as unknown as UpdateKitExplicitConfig;
}

// ─── Command Handlers ───

async function handleDetect(kit: UpdateKit, isJson: boolean): Promise<void> {
  const detection = await kit.detectInstall();

  if (isJson) {
    console.log(JSON.stringify(detection, null, 2));
  } else {
    console.log(`Channel:    ${detection.channel}`);
    console.log(`Confidence: ${detection.confidence}`);
    console.log('Evidence:');
    for (const e of detection.evidence) {
      console.log(`  - [${e.source}] ${e.detail}`);
    }
  }
}

async function handleCheck(
  kit: UpdateKit,
  flags: Record<string, string | boolean>,
  isJson: boolean,
): Promise<void> {
  if (flags['background']) {
    kit.checkUpdate('non-blocking');
    console.log('Background check started');
    return;
  }

  const mode = flags['blocking'] ? 'blocking' : 'non-blocking';
  const status = await kit.checkUpdate(mode as 'blocking' | 'non-blocking');

  if (isJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    switch (status.kind) {
      case 'available':
        console.log(`Update available: ${status.current} → ${status.latest}`);
        if (status.releaseUrl) console.log(`Release: ${status.releaseUrl}`);
        break;
      case 'up-to-date':
        console.log(`Up to date: ${status.current}`);
        break;
      case 'unknown':
        console.log(`Unable to check: ${status.reason}`);
        break;
    }
  }
}

async function handlePlan(kit: UpdateKit, isJson: boolean): Promise<void> {
  const detection = await kit.detectInstall();
  const status = await kit.checkUpdate('blocking');

  if (status.kind !== 'available') {
    console.log(
      isJson
        ? JSON.stringify({ message: 'No update available' })
        : 'No update available',
    );
    return;
  }

  const plan = kit.planUpdate(status, detection);

  if (!plan) {
    console.log(
      isJson
        ? JSON.stringify({ message: 'No plan could be created' })
        : 'No plan could be created',
    );
    return;
  }

  if (isJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`Plan: ${plan.kind.type}`);
    console.log(`From: ${plan.fromVersion} → To: ${plan.toVersion}`);
    console.log(`Post action: ${plan.postAction}`);
    if (plan.kind.type === 'delegate-command') {
      console.log(`Command: ${plan.kind.command.join(' ')}`);
    }
  }
}

async function handleApply(
  kit: UpdateKit,
  isJson: boolean,
): Promise<void> {
  const result = await kit.autoUpdate();

  if (isJson) {
    console.log(
      JSON.stringify(
        result,
        (_, v) => (v instanceof Error ? { message: v.message } : v),
        2,
      ),
    );
  } else {
    switch (result.kind) {
      case 'success':
        console.log(`Updated: ${result.fromVersion} → ${result.toVersion}`);
        break;
      case 'needs-restart':
        console.log(result.message);
        break;
      case 'failed':
        console.error(`Update failed: ${result.error.message}`);
        process.exit(1);
    }
  }
}

async function handleCache(
  subcommand: string | undefined,
  config: UpdateKitExplicitConfig,
  isJson: boolean,
): Promise<void> {
  const cacheDir = config.cacheDir ?? getDefaultCacheDir();

  switch (subcommand) {
    case 'show': {
      const entry = await readCache(cacheDir, config.appName);
      if (!entry) {
        console.log(isJson ? JSON.stringify({ cache: null }) : 'No cache found');
        return;
      }
      console.log(
        isJson
          ? JSON.stringify(entry, null, 2)
          : `Cache contents:\n${JSON.stringify(entry, null, 2)}`,
      );
      break;
    }
    case 'clear': {
      await clearCache(cacheDir, config.appName);
      console.log(
        isJson ? JSON.stringify({ cleared: true }) : 'Cache cleared',
      );
      break;
    }
    default:
      console.error('Usage: update-kit cache <show|clear>');
      process.exit(1);
  }
}

async function handleDoctor(
  flags: Record<string, string | boolean>,
  isJson: boolean,
): Promise<void> {
  const configPath = typeof flags['config'] === 'string'
    ? resolve(flags['config'])
    : resolve(process.cwd(), 'update-kit.config.json');

  const report = await runDoctor(configPath, { cwd: process.cwd() });

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const check of report.checks) {
    const icon =
      check.status === 'pass'
        ? 'PASS'
        : check.status === 'fail'
          ? 'FAIL'
          : check.status === 'warn'
            ? 'WARN'
            : 'SKIP';
    console.log(`  [${icon}] ${check.name}: ${check.message}`);
    if (check.details) {
      for (const [key, value] of Object.entries(check.details)) {
        const display =
          typeof value === 'object' ? JSON.stringify(value) : String(value);
        console.log(`         ${key}: ${display}`);
      }
    }
  }

  console.log();
  const parts = [`${report.summary.passed}/${report.summary.total} passed`];
  if (report.summary.failed > 0) parts.push(`${report.summary.failed} failed`);
  if (report.summary.warnings > 0)
    parts.push(`${report.summary.warnings} warnings`);
  console.log(`  Summary: ${parts.join(', ')}`);

  if (report.summary.failed > 0) {
    process.exit(1);
  }
}

function printUsage(): void {
  console.log(
    `
update-kit - CLI app update management toolkit

Usage: update-kit <command> [options]

Commands:
  detect              Detect install channel
  check [--blocking]  Check for updates
  check --background  Trigger background check only
  plan                Detect + check + plan update
  apply [--execute]   Run full update pipeline
  cache show          Show current cache contents
  cache clear         Clear cache
  doctor              Run diagnostics (config, sources, connectivity)

Options:
  --config <path>     Path to config file (default: ./update-kit.config.json)
  --json              Output as JSON
  --help              Show this help message
  `.trim(),
  );
}

// ─── Main ───

async function main(): Promise<void> {
  const { command, subcommand, flags } = parseArgs(process.argv);

  if (flags['help'] || command === 'help') {
    printUsage();
    return;
  }

  const isJson = flags['json'] === true;

  if (command === 'doctor') {
    await handleDoctor(flags, isJson);
    return;
  }

  const config = loadConfig(flags['config'] as string | undefined);

  if (command === 'cache') {
    await handleCache(subcommand, config, isJson);
    return;
  }

  // For apply --execute, override delegateMode in config
  const effectiveConfig =
    command === 'apply' && flags['execute']
      ? { ...config, delegateMode: 'execute' as const }
      : config;

  const kit = new UpdateKit(effectiveConfig);

  switch (command) {
    case 'detect':
      await handleDetect(kit, isJson);
      break;
    case 'check':
      await handleCheck(kit, flags, isJson);
      break;
    case 'plan':
      await handlePlan(kit, isJson);
      break;
    case 'apply':
      await handleApply(kit, isJson);
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
