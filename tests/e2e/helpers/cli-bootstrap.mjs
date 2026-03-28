// Injected via node --import to mock fetch inside CLI child process.
// Reads routes from FETCH_MOCK_DIR/routes.json

import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockDir = process.env.FETCH_MOCK_DIR;

if (mockDir) {
  const routesPath = join(mockDir, "routes.json");
  let routes;
  try {
    routes = JSON.parse(readFileSync(routesPath, "utf-8"));
  } catch {
    routes = [];
  }

  const compiledRoutes = routes.map((r) => ({
    pattern: new RegExp(r.url),
    status: r.status ?? 200,
    headers: r.headers ?? {},
    file: r.file ?? null,
    body: r.body ?? null,
    binary: r.binary ?? false,
  }));

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const route = compiledRoutes.find((r) => r.pattern.test(url));
    if (!route) {
      throw new Error(`[cli-bootstrap] No fetch mock route matched: ${url}`);
    }

    let bodyInit;
    if (route.file) {
      const filePath = join(mockDir, route.file);
      if (route.binary) {
        bodyInit = readFileSync(filePath);
      } else {
        bodyInit = readFileSync(filePath, "utf-8");
      }
    } else if (route.body !== null) {
      bodyInit =
        typeof route.body === "string"
          ? route.body
          : JSON.stringify(route.body);
    }

    const headers = new Headers(route.headers);
    if (bodyInit && !headers.has("content-length")) {
      const len =
        typeof bodyInit === "string"
          ? Buffer.byteLength(bodyInit)
          : bodyInit.length;
      headers.set("content-length", String(len));
    }

    return new Response(bodyInit ?? null, {
      status: route.status,
      headers,
    });
  };
}
