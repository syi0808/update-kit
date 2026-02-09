import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolvedUpdateKitConfig } from "../config.js";
import type { InstallDetection } from "../types.js";

interface InstallReceipt {
  appName: string;
  channel: string;
  installedAt?: string;
  version?: string;
}

/**
 * Detect install channel from a receipt file.
 * Returns 'native' channel with 'high' confidence when a valid receipt
 * exists and the appName matches.
 */
export async function detectFromReceipt(
  config: Pick<ResolvedUpdateKitConfig, "appName">,
  receiptDir?: string,
): Promise<InstallDetection | null> {
  const dir = receiptDir ?? join(homedir(), ".config", config.appName);
  const receiptPath = join(dir, "install-receipt.json");

  try {
    const content = await readFile(receiptPath, "utf-8");
    const receipt: InstallReceipt = JSON.parse(content);

    if (receipt.appName !== config.appName) {
      return null;
    }

    return {
      channel: receipt.channel ?? "native",
      confidence: "high",
      evidence: [
        {
          source: "receipt_file",
          detail: `Receipt file found: ${receiptPath}`,
        },
      ],
    };
  } catch {
    return null;
  }
}
