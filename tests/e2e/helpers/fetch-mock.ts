export interface FetchMockRoute {
  url: string | RegExp;
  method?: string;
  response: {
    status?: number;
    headers?: Record<string, string>;
    body?: string | Buffer | object;
  };
}

interface FetchCall {
  url: string;
  method: string;
  headers: Headers;
}

export function setupFetchMock(routes: FetchMockRoute[]) {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

    // Respect AbortSignal: throw if already aborted before routing
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) {
      const err = new DOMException("The operation was aborted.", "AbortError");
      throw err;
    }

    calls.push({ url, method, headers });

    const route = routes.find((r) => {
      const urlMatch = typeof r.url === "string" ? url === r.url : r.url.test(url);
      const methodMatch = !r.method || r.method.toUpperCase() === method.toUpperCase();
      return urlMatch && methodMatch;
    });

    if (!route) {
      throw new Error(`No fetch mock route matched: ${method} ${url}`);
    }

    const status = route.response.status ?? 200;
    const resHeaders = new Headers(route.response.headers);

    let bodyInit: BodyInit | null = null;
    const { body } = route.response;

    if (body === undefined || body === null) {
      bodyInit = null;
    } else if (Buffer.isBuffer(body)) {
      bodyInit = new Uint8Array(body);
      if (!resHeaders.has("content-length")) {
        resHeaders.set("content-length", String(body.length));
      }
    } else if (typeof body === "string") {
      bodyInit = body;
      if (!resHeaders.has("content-length")) {
        resHeaders.set("content-length", String(Buffer.byteLength(body)));
      }
    } else {
      const json = JSON.stringify(body);
      bodyInit = json;
      if (!resHeaders.has("content-type")) {
        resHeaders.set("content-type", "application/json");
      }
      if (!resHeaders.has("content-length")) {
        resHeaders.set("content-length", String(Buffer.byteLength(json)));
      }
    }

    return new Response(bodyInit, { status, headers: resHeaders });
  };

  return {
    restore() {
      globalThis.fetch = originalFetch;
    },
    calls(): readonly FetchCall[] {
      return calls;
    },
  };
}
