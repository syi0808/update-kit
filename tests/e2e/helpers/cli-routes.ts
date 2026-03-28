import fs from "node:fs/promises";
import path from "node:path";

export interface FetchRouteEntry {
  url: string;
  file?: string;
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
  binary?: boolean;
}

/**
 * Write a routes.json manifest and any inline body files for cli-bootstrap.mjs.
 * Returns the directory path to pass as FETCH_MOCK_DIR.
 */
export async function writeFetchRoutes(
  dir: string,
  routes: FetchRouteEntry[],
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });

  const routeEntries = [];
  for (const r of routes) {
    if (r.body && !r.file) {
      const filename = `inline-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
      await fs.writeFile(path.join(dir, filename), JSON.stringify(r.body));
      routeEntries.push({
        url: r.url,
        file: filename,
        status: r.status ?? 200,
        headers: r.headers,
      });
    } else {
      routeEntries.push({
        url: r.url,
        file: r.file,
        status: r.status ?? 200,
        binary: r.binary,
        headers: r.headers,
      });
    }
  }

  await fs.writeFile(
    path.join(dir, "routes.json"),
    JSON.stringify(routeEntries),
  );
  return dir;
}
