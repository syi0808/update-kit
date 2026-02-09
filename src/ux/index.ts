import type {
  ApplyProgress,
  ApplyResult,
  InstallDetection,
  UpdateStatus,
} from "../types.js";
import { bold, green, red, yellow } from "./colors.js";
import type { MessageTemplates } from "./templates.js";
import { defaultTemplates } from "./templates.js";

export function renderBanner(
  status: UpdateStatus,
  detection: InstallDetection,
  config?: Partial<MessageTemplates>,
): string | null {
  if (status.kind !== "available") return null;

  const templates = { ...defaultTemplates, ...config };
  const command = resolveUpdateCommand(detection);

  const message = templates.updateAvailable({
    current: status.current,
    latest: status.latest,
    command,
  });

  return message
    .replace(status.current, bold(status.current))
    .replace(status.latest, bold(green(status.latest)));
}

export function renderProgress(progress: ApplyProgress): string {
  if (progress.phase === "downloading") {
    const pct = progress.totalBytes
      ? progress.bytesDownloaded / progress.totalBytes
      : undefined;
    return defaultTemplates.updateInProgress({
      phase: "downloading",
      progress: pct,
    });
  }
  return defaultTemplates.updateInProgress({ phase: progress.phase });
}

export function renderResult(result: ApplyResult): string {
  if (result.kind === "success") {
    return green(
      defaultTemplates.updateSuccess({
        version: result.toVersion,
        postAction: result.postAction,
      }),
    );
  }
  if (result.kind === "up-to-date") {
    return green(`Already up to date (${result.current}).`);
  }
  if (result.kind === "needs-restart") {
    return yellow(result.message);
  }
  return red(defaultTemplates.updateFailed({ error: result.error.message }));
}

function resolveUpdateCommand(detection: InstallDetection): string | undefined {
  switch (detection.channel) {
    case "npm-global":
      return "npm update -g <package>";
    case "brew-cask":
      return "brew upgrade --cask <package>";
    default:
      return undefined;
  }
}

export {
  bold,
  dim,
  green,
  red,
  stripAnsi,
  supportsColor,
  yellow,
} from "./colors.js";
export type { MessageTemplates } from "./templates.js";
export { defaultTemplates } from "./templates.js";
