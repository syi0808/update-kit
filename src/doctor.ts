import type { VersionSourceConfig, ResolvedUpdateKitConfig } from './config.js';
import type { Channel } from './types.js';
import { createVersionSource } from './checker/sources/index.js';
import {
  inferSourceConfigs,
  orderSourcesByChannel,
  parseGitHubRepository,
} from './checker/infer-sources.js';
import { detectInstall } from './detection/index.js';
import { findPackageJson } from './utils/package-json.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeVersion } from './checker/index.js';

/** Result of a single diagnostic check */
export interface DiagnosticCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  details?: Record<string, unknown>;
}

/** Full doctor report */
export interface DoctorReport {
  checks: DiagnosticCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
}

/**
 * Run all diagnostic checks.
 *
 * @param configPath - Path to the update-kit config file.
 * @param options.cwd - Working directory to search for package.json (default: process.cwd()).
 */
export async function runDoctor(
  configPath: string,
  options?: { cwd?: string },
): Promise<DoctorReport> {
  const checks: DiagnosticCheck[] = [];
  const cwd = options?.cwd ?? process.cwd();

  // 1. Config file check
  const configResult = checkConfigFile(configPath);
  checks.push(configResult.check);

  // 2. Package.json analysis
  const pkgCheck = await checkPackageJson(cwd);
  checks.push(pkgCheck);

  // 3. Source resolution (only if config loaded)
  if (configResult.config) {
    checks.push(checkSourceResolution(configResult.config, pkgCheck.details));

    // 4. Install detection
    const detectionCheck = await checkDetection(configResult.config);
    checks.push(detectionCheck);

    // 5. Source connectivity
    const channel = detectionCheck.details?.channel as Channel | undefined;
    const connectivityChecks = await checkSourceConnectivity(
      configResult.config,
      pkgCheck.details,
      channel,
    );
    checks.push(...connectivityChecks);
  }

  return buildReport(checks);
}

// ─── Individual Checks ───

function checkConfigFile(configPath: string): {
  check: DiagnosticCheck;
  config: ResolvedUpdateKitConfig | null;
} {
  const fullPath = resolve(configPath);

  if (!existsSync(fullPath)) {
    return {
      check: {
        name: 'Config file',
        status: 'fail',
        message: `Not found: ${fullPath}`,
      },
      config: null,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(fullPath, 'utf-8'));
  } catch {
    return {
      check: {
        name: 'Config file',
        status: 'fail',
        message: `Invalid JSON: ${fullPath}`,
      },
      config: null,
    };
  }

  const obj = raw as Record<string, unknown>;
  const issues: string[] = [];

  if (!obj.appName || typeof obj.appName !== 'string') {
    issues.push('missing appName');
  }
  if (!obj.currentVersion || typeof obj.currentVersion !== 'string') {
    issues.push('missing currentVersion');
  } else if (!normalizeVersion(obj.currentVersion as string)) {
    issues.push(`invalid semver: ${obj.currentVersion}`);
  }

  if (issues.length > 0) {
    return {
      check: {
        name: 'Config file',
        status: 'fail',
        message: `Validation errors: ${issues.join(', ')}`,
        details: { path: fullPath },
      },
      config: null,
    };
  }

  // Build a minimal resolved config
  const config: ResolvedUpdateKitConfig = {
    appName: obj.appName as string,
    currentVersion: obj.currentVersion as string,
    checkInterval: (obj.checkInterval as number) ?? 72_000_000,
    delegateMode: (obj.delegateMode as 'print-only' | 'execute') ?? 'print-only',
    allowReexec: (obj.allowReexec as boolean) ?? false,
    sources: obj.sources as VersionSourceConfig[] | undefined,
    npmPackageName: obj.npmPackageName as string | undefined,
    brewCaskName: obj.brewCaskName as string | undefined,
    repository: obj.repository as string | { url: string } | undefined,
    executablePath: obj.executablePath as string | undefined,
  };

  return {
    check: {
      name: 'Config file',
      status: 'pass',
      message: `Loaded: ${fullPath}`,
      details: {
        appName: config.appName,
        currentVersion: config.currentVersion,
        hasSources: Boolean(config.sources && config.sources.length > 0),
      },
    },
    config,
  };
}

async function checkPackageJson(
  cwd: string,
): Promise<DiagnosticCheck> {
  const result = await findPackageJson(cwd);
  if (!result) {
    return {
      name: 'Package.json',
      status: 'warn',
      message: 'Not found in current directory tree',
    };
  }

  const details: Record<string, unknown> = {
    path: result.path,
    name: result.name,
    version: result.version,
  };

  const warnings: string[] = [];

  // Check repository field
  if (result.repository) {
    details.repository = result.repository;
    const github = parseGitHubRepository(result.repository);
    if (github) {
      details.githubOwner = github.owner;
      details.githubRepo = github.repo;
    } else {
      warnings.push('repository is not a GitHub URL (GitHub source cannot be auto-inferred)');
    }
  } else {
    warnings.push('no repository field (GitHub source cannot be auto-inferred)');
  }

  if (warnings.length > 0) {
    return {
      name: 'Package.json',
      status: 'warn',
      message: warnings.join('; '),
      details,
    };
  }

  return {
    name: 'Package.json',
    status: 'pass',
    message: `${result.name}@${result.version}`,
    details,
  };
}

function checkSourceResolution(
  config: ResolvedUpdateKitConfig,
  pkgDetails?: Record<string, unknown>,
): DiagnosticCheck {
  const hasExplicit = config.sources && config.sources.length > 0;

  if (hasExplicit) {
    const types = config.sources!.map((s) => s.type);
    return {
      name: 'Sources',
      status: 'pass',
      message: `Explicit: ${types.join(', ')}`,
      details: { mode: 'explicit', sources: config.sources },
    };
  }

  // Build an effective config that includes repository from package.json
  const effectiveConfig = { ...config };
  if (!effectiveConfig.repository && pkgDetails?.repository) {
    const repoRaw = pkgDetails.repository;
    if (typeof repoRaw === 'string') {
      effectiveConfig.repository = repoRaw;
    } else if (typeof repoRaw === 'object' && repoRaw !== null) {
      const url = (repoRaw as Record<string, unknown>).url;
      if (typeof url === 'string') {
        effectiveConfig.repository = { url };
      }
    }
  }

  const inferred = inferSourceConfigs(effectiveConfig);
  if (inferred.length === 0) {
    return {
      name: 'Sources',
      status: 'fail',
      message: 'No sources could be inferred and none were configured',
    };
  }

  const types = inferred.map((s) => s.type);
  return {
    name: 'Sources',
    status: 'pass',
    message: `Auto-inferred: ${types.join(', ')}`,
    details: { mode: 'inferred', sources: inferred },
  };
}

async function checkDetection(
  config: ResolvedUpdateKitConfig,
): Promise<DiagnosticCheck> {
  try {
    const execPath = config.executablePath ?? process.argv[1];
    const detection = await detectInstall(execPath, config);
    return {
      name: 'Detection',
      status: 'pass',
      message: `${detection.channel} (${detection.confidence})`,
      details: {
        channel: detection.channel,
        confidence: detection.confidence,
        evidence: detection.evidence,
      },
    };
  } catch (err) {
    return {
      name: 'Detection',
      status: 'fail',
      message: `Detection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkSourceConnectivity(
  config: ResolvedUpdateKitConfig,
  pkgDetails: Record<string, unknown> | undefined,
  channel?: Channel,
): Promise<DiagnosticCheck[]> {
  const hasExplicit = config.sources && config.sources.length > 0;

  let sourceConfigs: VersionSourceConfig[];
  if (hasExplicit) {
    sourceConfigs = config.sources!;
  } else {
    const effectiveConfig = { ...config };
    if (!effectiveConfig.repository && pkgDetails?.repository) {
      const repoRaw = pkgDetails.repository;
      if (typeof repoRaw === 'string') {
        effectiveConfig.repository = repoRaw;
      } else if (typeof repoRaw === 'object' && repoRaw !== null) {
        const url = (repoRaw as Record<string, unknown>).url;
        if (typeof url === 'string') {
          effectiveConfig.repository = { url };
        }
      }
    }
    sourceConfigs = inferSourceConfigs(effectiveConfig);
    if (channel) {
      sourceConfigs = orderSourcesByChannel(sourceConfigs, channel);
    }
  }

  if (sourceConfigs.length === 0) {
    return [
      {
        name: 'Connectivity',
        status: 'skip',
        message: 'No sources to check',
      },
    ];
  }

  const checks: DiagnosticCheck[] = [];
  for (const sourceConfig of sourceConfigs) {
    const check = await checkSingleSource(sourceConfig);
    checks.push(check);
  }

  return checks;
}

async function checkSingleSource(
  sourceConfig: VersionSourceConfig,
): Promise<DiagnosticCheck> {
  const label = `Source: ${sourceConfig.type}`;
  try {
    const source = createVersionSource(sourceConfig);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const result = await source.fetchLatest({ signal: controller.signal });
      clearTimeout(timeout);

      switch (result.kind) {
        case 'found':
          return {
            name: label,
            status: 'pass',
            message: `v${result.info.version}`,
            details: {
              version: result.info.version,
              releaseUrl: result.info.releaseUrl,
            },
          };
        case 'not-modified':
          return {
            name: label,
            status: 'pass',
            message: 'Reachable (not-modified)',
          };
        case 'error':
          return {
            name: label,
            status: 'fail',
            message: result.reason,
          };
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return {
      name: label,
      status: 'fail',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildReport(checks: DiagnosticCheck[]): DoctorReport {
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === 'pass').length,
    failed: checks.filter((c) => c.status === 'fail').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
    skipped: checks.filter((c) => c.status === 'skip').length,
  };

  return { checks, summary };
}
