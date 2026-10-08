import { createIGDB, type IGDBClientOptions, LocalLimiter } from "../../src";

export interface Call {
  url: string;
  body: string;
  headers: Record<string, string>;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** A fake fetch: the Twitch token endpoint always succeeds, IGDB calls go to `handler`. */
export function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://id.twitch.tv")) {
      tokens++;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 5_000_000 });
    }
    const call: Call = {
      url,
      body: String(init?.body ?? ""),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;
  return {
    fetch,
    calls,
    get tokenFetches() {
      return tokens;
    },
  };
}

export function testClient(fetch: typeof globalThis.fetch, options: Partial<IGDBClientOptions> = {}) {
  return createIGDB({
    clientId: "test-client",
    clientSecret: "test-secret",
    fetch,
    // A private, fast limiter so tests do not wait on the real 4 req/s quota.
    limiter: new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1000, rateLimitPauseMs: 1 }),
    retryTimeoutMs: 5_000,
    ...options,
  });
}

export const apicalypseError = (status: number, title: string, cause?: string) =>
  Response.json([{ title, status, ...(cause ? { cause } : {}) }], { status });
