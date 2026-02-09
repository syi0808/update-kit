import type { PostAction } from '../types.js';

export interface MessageTemplates {
  updateAvailable: (ctx: { current: string; latest: string; command?: string }) => string;
  updateInProgress: (ctx: { phase: string; progress?: number }) => string;
  updateSuccess: (ctx: { version: string; postAction: PostAction }) => string;
  updateFailed: (ctx: { error: string }) => string;
  manualInstruction: (ctx: { instructions: string; downloadUrl?: string }) => string;
}

export const defaultTemplates: MessageTemplates = {
  updateAvailable({ current, latest, command }) {
    const base = `Update available: ${current} → ${latest}`;
    return command ? `${base}\n  Run \`${command}\` to update.` : base;
  },

  updateInProgress({ phase, progress }) {
    const pct = progress != null ? ` (${Math.round(progress * 100)}%)` : '';
    return `Updating... ${phase}${pct}`;
  },

  updateSuccess({ version, postAction }) {
    const base = `Updated to ${version}.`;
    if (postAction === 'suggest-restart') {
      return `${base} Please restart the application.`;
    }
    if (postAction === 'exit-after-apply') {
      return `${base} The application will now exit.`;
    }
    return base;
  },

  updateFailed({ error }) {
    return `Update failed: ${error}`;
  },

  manualInstruction({ instructions, downloadUrl }) {
    const base = instructions;
    return downloadUrl ? `${base}\n  Download: ${downloadUrl}` : base;
  },
};
