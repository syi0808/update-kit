import { normalizeVersion } from "../checker/index.js";
import type { AssetInfo } from "../checker/sources/index.js";
import type { ResolvedUpdateKitConfig } from "../config.js";
import type {
  Channel,
  Confidence,
  DelegateMode,
  InstallDetection,
  PlanKind,
  PostAction,
  UpdatePlan,
  UpdateStatus,
} from "../types.js";

/** Options for planUpdate */
export interface PlanUpdateOptions {
  /** Override the target version. When set, plans for this version instead of status.latest. */
  targetVersion?: string;
  /** Release assets for native-in-place strategy */
  assets?: AssetInfo[];
}

/**
 * Create an update plan based on version status, installation detection, and configuration.
 * Pure function — no I/O, no side effects.
 *
 * Returns null if no update is needed (status is not 'available' and no targetVersion specified).
 */
export function planUpdate(
  status: UpdateStatus,
  detection: InstallDetection,
  config: ResolvedUpdateKitConfig,
  options?: AssetInfo[] | PlanUpdateOptions,
): UpdatePlan | null {
  // Normalize options: support legacy assets array or new options object
  const opts: PlanUpdateOptions = Array.isArray(options)
    ? { assets: options }
    : (options ?? {});

  const { targetVersion, assets } = opts;

  if (targetVersion) {
    // Explicit target version (upgrade or downgrade)
    const current =
      status.kind === "available"
        ? status.current
        : status.kind === "up-to-date"
          ? status.current
          : config.currentVersion;

    const normalizedCurrent = normalizeVersion(current);
    const normalizedTarget = normalizeVersion(targetVersion);
    if (
      normalizedCurrent &&
      normalizedTarget &&
      normalizedCurrent === normalizedTarget
    ) {
      return null;
    }

    const { channel, confidence } = detection;
    const kind = resolvePlanKind(
      channel,
      confidence,
      targetVersion,
      config,
      assets,
    );
    const postAction = resolvePostAction(kind, confidence, config);

    return {
      kind,
      fromVersion: current,
      toVersion: targetVersion,
      postAction,
    };
  }

  if (status.kind !== "available") {
    return null;
  }

  const { channel, confidence } = detection;
  const fromVersion = status.current;
  const toVersion = status.latest;

  let kind = resolvePlanKind(channel, confidence, toVersion, config, assets);

  // Allow custom plan resolver to override
  if (config.customPlanResolver) {
    const custom = config.customPlanResolver({
      channel,
      confidence,
      toVersion,
      config,
      assets,
      defaultPlan: kind,
    });
    if (custom) kind = custom;
  }

  const postAction = resolvePostAction(kind, confidence, config);

  return {
    kind,
    fromVersion,
    toVersion,
    postAction,
  };
}

// ──────────────────────────────────────────────
// Channel dispatch
// ──────────────────────────────────────────────

function resolvePlanKind(
  channel: Channel,
  confidence: Confidence,
  toVersion: string,
  config: ResolvedUpdateKitConfig,
  assets?: AssetInfo[],
): PlanKind {
  switch (channel) {
    case "native":
      return resolveNativeChannel(confidence, config, assets);

    case "unmanaged":
      return resolveUnmanagedChannel(confidence, config, assets);

    case "npm-global":
      return resolveNpmChannel(confidence, toVersion, config);

    case "brew-cask":
      return resolveBrewChannel(confidence, toVersion, config);

    default:
      return {
        type: "manual-install",
        reason: `Unknown install channel: ${channel}`,
        instructions:
          "Please update manually using your original installation method.",
      };
  }
}

// ──────────────────────────────────────────────
// Channel-specific resolvers
// ──────────────────────────────────────────────

function resolveNativeChannel(
  confidence: Confidence,
  config: ResolvedUpdateKitConfig,
  assets?: AssetInfo[],
): PlanKind {
  if (confidence === "low") {
    return {
      type: "manual-install",
      reason: "Low confidence in native channel detection.",
      instructions: "Please download and install the update manually.",
      downloadUrl: assets?.[0]?.url,
    };
  }

  return resolveNativeInPlace(assets, config);
}

function resolveUnmanagedChannel(
  confidence: Confidence,
  config: ResolvedUpdateKitConfig,
  assets?: AssetInfo[],
): PlanKind {
  if (confidence === "none") {
    return {
      type: "manual-install",
      reason: "Unable to detect installation method.",
      instructions:
        "Please reinstall using your preferred installation method.",
    };
  }

  return resolveNativeInPlace(assets, config);
}

function resolveNpmChannel(
  confidence: Confidence,
  toVersion: string,
  config: ResolvedUpdateKitConfig,
): PlanKind {
  if (confidence === "low") {
    return {
      type: "manual-install",
      reason: "Low confidence in npm-global detection.",
      instructions: `Please update manually: npm install -g ${config.npmPackageName ?? config.appName}`,
    };
  }

  const packageName = config.npmPackageName ?? config.appName;
  const mode: DelegateMode = config.delegateMode ?? "print-only";

  return {
    type: "delegate-command",
    channel: "npm-global",
    command: ["npm", "install", "-g", `${packageName}@${toVersion}`],
    mode,
  };
}

function resolveBrewChannel(
  confidence: Confidence,
  _toVersion: string,
  config: ResolvedUpdateKitConfig,
): PlanKind {
  if (confidence === "low") {
    return {
      type: "manual-install",
      reason: "Low confidence in brew-cask detection.",
      instructions: `Please update manually: brew upgrade --cask ${config.brewCaskName ?? config.appName}`,
    };
  }

  const caskName = config.brewCaskName ?? config.appName;
  const mode: DelegateMode = config.delegateMode ?? "print-only";

  return {
    type: "delegate-command",
    channel: "brew-cask",
    command: ["brew", "upgrade", "--cask", caskName],
    mode,
  };
}

// ──────────────────────────────────────────────
// Shared native-in-place resolution
// ──────────────────────────────────────────────

function resolveNativeInPlace(
  assets: AssetInfo[] | undefined,
  config: ResolvedUpdateKitConfig,
): PlanKind {
  if (!assets || assets.length === 0) {
    return {
      type: "manual-install",
      reason: "No release assets available.",
      instructions:
        "Please check the project website for installation instructions.",
    };
  }

  const selected = selectAsset(assets, config);

  if (!selected) {
    return {
      type: "manual-install",
      reason: `No compatible asset found for ${process.platform}/${process.arch}.`,
      instructions:
        "Please download and install the update manually for your platform.",
      downloadUrl: assets[0]?.url,
    };
  }

  return {
    type: "native-in-place",
    downloadUrl: selected.url,
    checksumUrl: selected.checksumUrl,
  };
}

// ──────────────────────────────────────────────
// PostAction resolution
// ──────────────────────────────────────────────

function resolvePostAction(
  kind: PlanKind,
  confidence: Confidence,
  config: ResolvedUpdateKitConfig,
): PostAction {
  switch (kind.type) {
    case "native-in-place":
      if (confidence === "high" && config.allowReexec === true) {
        return "reexec";
      }
      return "suggest-restart";

    case "delegate-command":
      return "exit-after-apply";

    case "manual-install":
      return "none";
  }
}

// ──────────────────────────────────────────────
// Asset selection
// ──────────────────────────────────────────────

/**
 * Select the appropriate asset for the current platform/architecture.
 *
 * Matching priority:
 * 1. User-defined assetPattern with placeholder expansion
 * 2. Auto-matching by platform/architecture keywords
 */
export function selectAsset(
  assets: AssetInfo[],
  config: ResolvedUpdateKitConfig,
  platform: string = process.platform,
  arch: string = process.arch,
): AssetInfo | null {
  if (assets.length === 0) return null;

  // Priority 1: user-defined placeholder pattern
  if (config.assetPattern) {
    const regex = expandAssetPattern(
      config.assetPattern,
      config,
      platform,
      arch,
    );
    const match = assets.find((a) => regex.test(a.name));
    if (match) return match;
  }

  // Priority 2: auto-match by platform + arch keywords
  return autoMatchAsset(assets, platform, arch);
}

/**
 * Expand a placeholder-based asset pattern into a RegExp.
 *
 * Supported placeholders:
 * - {app}      → config.appName (literal)
 * - {version}  → any semver-like string
 * - {target}   → platform-arch (e.g. "darwin-arm64")
 * - {platform} → platform aliases joined with |
 * - {arch}     → arch aliases joined with |
 * - {ext}      → common archive extensions
 */
export function expandAssetPattern(
  pattern: string,
  config: ResolvedUpdateKitConfig,
  platform: string,
  arch: string,
): RegExp {
  if (pattern.length > 256) {
    throw new Error(
      `Asset pattern is too long (${pattern.length} chars, max 256)`,
    );
  }

  const platformGroup = getPlatformAliases(platform).join("|");
  const archGroup = getArchAliases(arch).join("|");
  const targetGroup = `(${platformGroup})[_-](${archGroup})`;

  const expanded = pattern
    .replace(/[.+?^${}()|[\]\\]/g, (ch) => {
      // Don't escape our own placeholder braces
      if (ch === "{" || ch === "}") return ch;
      return `\\${ch}`;
    })
    .replace(/\{app\}/g, escapeRegex(config.appName))
    .replace(/\{version\}/g, "[\\w.+-]+")
    .replace(/\{target\}/g, targetGroup)
    .replace(/\{platform\}/g, `(${platformGroup})`)
    .replace(/\{arch\}/g, `(${archGroup})`)
    .replace(/\{ext\}/g, "(tar\\.gz|tgz|zip|gz|dmg|exe|msi|deb|rpm|pkg)");

  try {
    return new RegExp(`^${expanded}$`, "i");
  } catch (error) {
    throw new Error(
      `Invalid asset pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function autoMatchAsset(
  assets: AssetInfo[],
  platform: string,
  arch: string,
): AssetInfo | null {
  const platformAliases = getPlatformAliases(platform);
  const archAliases = getArchAliases(arch);

  return (
    assets.find((asset) => {
      const name = asset.name.toLowerCase();
      const matchesPlatform = platformAliases.some((alias) =>
        name.includes(alias),
      );
      const matchesArch = archAliases.some((alias) => name.includes(alias));
      return matchesPlatform && matchesArch;
    }) ?? null
  );
}

export function getPlatformAliases(platform: string): string[] {
  switch (platform) {
    case "darwin":
      return ["darwin", "macos", "mac", "osx", "apple"];
    case "linux":
      return ["linux"];
    case "win32":
      return ["win32", "windows", "win64"];
    default:
      return [platform];
  }
}

export function getArchAliases(arch: string): string[] {
  switch (arch) {
    case "x64":
      return ["x64", "x86_64", "amd64"];
    case "arm64":
      return ["arm64", "aarch64"];
    case "ia32":
      return ["ia32", "x86", "i386", "i686"];
    default:
      return [arch];
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
