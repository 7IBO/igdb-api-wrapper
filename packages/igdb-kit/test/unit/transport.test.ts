import { describe, expect, test } from "bun:test";
import {
  AuthError,
  IGDBError,
  memoryTokenStore,
  NetworkError,
  PayloadTooLargeError,
  QueryError,
  RateLimitError,
  type RequestLog,
} from "../../src";
import { apicalypseError, mockFetch, testClient } from "./helpers";

describe("transport", () => {
  test("sends the IGDB headers and the Apicalypse body", async () => {
    const mock = mockFetch(() => Response.json([]));
    await testClient(mock.fetch).games.select("name").limit(1);
    expect(mock.calls[0]?.url).toBe("https://api.igdb.com/v4/games");
    expect(mock.calls[0]?.headers["client-id"]).toBe("test-client");
    expect(mock.calls[0]?.headers.authorization).toBe("Bearer token-1");
  });

  test("concurrent requests share one token fetch", async () => {
    const mock = mockFetch(() => Response.json([]));
    const client = testClient(mock.fetch);
    await Promise.all(Array.from({ length: 20 }, () => client.games.limit(1)));
    expect(mock.tokenFetches).toBe(1);
  });

  test("a 401 renews the token once and replays the request", async () => {
    const mock = mockFetch((call) =>
      call.headers.authorization === "Bearer token-1"
        ? Response.json({ message: "Authorization Failure" }, { status: 401 })
        : Response.json([{ id: 1 }]),
    );
    const client = testClient(mock.fetch);
    expect(await client.games.limit(1)).toEqual([{ id: 1 }]);
    expect(mock.tokenFetches).toBe(2);
    expect(mock.calls).toHaveLength(2);
  });

  test("a second 401 throws AuthError", async () => {
    const mock = mockFetch(() => Response.json({ message: "Authorization Failure" }, { status: 401 }));
    await expect(testClient(mock.fetch).games.limit(1).execute()).rejects.toBeInstanceOf(AuthError);
    expect(mock.calls).toHaveLength(2);
  });

  test("a 401 with a fixed accessToken is not retried", async () => {
    const mock = mockFetch(() => Response.json({ message: "nope" }, { status: 401 }));
    const client = testClient(mock.fetch, { clientSecret: undefined, accessToken: "fixed" });
    await expect(client.games.limit(1).execute()).rejects.toBeInstanceOf(AuthError);
    expect(mock.calls).toHaveLength(1);
    expect(mock.tokenFetches).toBe(0);
  });

  test("the token is reused from a shared store", async () => {
    const store = memoryTokenStore();
    await store.set({ token: "from-store", expiresAt: Date.now() + 30 * 86_400_000 });
    const mock = mockFetch(() => Response.json([]));
    await testClient(mock.fetch, { tokenStore: store }).games.limit(1);
    expect(mock.calls[0]?.headers.authorization).toBe("Bearer from-store");
    expect(mock.tokenFetches).toBe(0);
  });

  test("429 and 5xx are retried", async () => {
    const statuses = [429, 503, 200];
    const mock = mockFetch(() => {
      const status = statuses.shift() ?? 200;
      return status === 200
        ? Response.json([{ id: 1 }])
        : Response.json({ message: "Too Many Requests" }, { status });
    });
    expect(await testClient(mock.fetch).games.limit(1)).toEqual([{ id: 1 }]);
    expect(mock.calls).toHaveLength(3);
  });

  test("hooks.onRequest reports every try, multiquery blocks and cache hits, and its errors are ignored", async () => {
    const statuses = [503, 200];
    const mock = mockFetch(() => {
      const status = statuses.shift() ?? 200;
      return status === 200 ? Response.json([{ id: 1 }]) : Response.json({ message: "down" }, { status });
    });
    const logs: RequestLog[] = [];
    const client = testClient(mock.fetch, {
      hooks: {
        onRequest: (log) => {
          logs.push(log);
          throw new Error("a broken logger");
        },
      },
    });
    await client.games.select("name").limit(1).cache(60_000);
    await client.games.select("name").limit(1).cache(60_000);
    await client.batch({ a: client.games.limit(1), b: client.platforms.limit(1) });
    const fields = logs.map(({ durationMs, ...log }) => {
      expect(durationMs).toBeGreaterThanOrEqual(0);
      return log;
    });
    expect(fields).toEqual([
      { path: "games", method: "POST", status: 503, bytes: 18, attempt: 1, blocks: 1, cached: false },
      { path: "games", method: "POST", status: 200, bytes: 10, attempt: 2, blocks: 1, cached: false },
      { path: "games", method: "POST", status: 200, bytes: 10, attempt: 1, blocks: 1, cached: true },
      { path: "multiquery", method: "POST", status: 200, bytes: 69, attempt: 1, blocks: 2, cached: false },
    ]);
  });

  test("hooks.onRequest reports a request that got no answer with status 0", async () => {
    const logs: RequestLog[] = [];
    const broken = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = testClient(broken.fetch, {
      retryTimeoutMs: 1,
      hooks: { onRequest: (log) => logs.push(log) },
    });
    await expect(client.games.limit(1).execute()).rejects.toBeInstanceOf(NetworkError);
    expect(logs.map((log) => [log.status, log.bytes, log.attempt])).toEqual([[0, 0, 1]]);
  });

  test("429 past the retry budget throws RateLimitError", async () => {
    const mock = mockFetch(() => Response.json({ message: "Too Many Requests" }, { status: 429 }));
    const client = testClient(mock.fetch, { retryTimeoutMs: 300 });
    await expect(client.games.limit(1).execute()).rejects.toBeInstanceOf(RateLimitError);
  });

  test("network errors are retried, then reported", async () => {
    let failures = 2;
    const mock = mockFetch(() => {
      if (failures-- > 0) throw new TypeError("fetch failed");
      return Response.json([]);
    });
    expect(await testClient(mock.fetch).games.limit(1)).toEqual([]);
    const broken = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(
      testClient(broken.fetch, { retryTimeoutMs: 200 }).games.limit(1).execute(),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  test("errors name the endpoint, and a body that is not JSON is an IGDBError", async () => {
    const broken = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const network = await testClient(broken.fetch, { retryTimeoutMs: 200 })
      .games.limit(1)
      .execute()
      .catch((e) => e);
    expect(network).toBeInstanceOf(NetworkError);
    expect(network).toMatchObject({ endpoint: "games", query: "limit 1;" });
    const limited = mockFetch(() => Response.json({ message: "Too Many Requests" }, { status: 429 }));
    const rate = await testClient(limited.fetch, { retryTimeoutMs: 300 })
      .games.limit(1)
      .execute()
      .catch((e) => e);
    expect(rate).toBeInstanceOf(RateLimitError);
    expect(rate).toMatchObject({ status: 429, endpoint: "games", query: "limit 1;" });
    // A proxyUrl that answers the app's HTML page.
    const html = mockFetch(
      () => new Response("<!doctype html><title>App</title>", { headers: { "content-type": "text/html" } }),
    );
    const page = await testClient(html.fetch)
      .games.limit(1)
      .execute()
      .catch((e) => e);
    expect(page).toBeInstanceOf(IGDBError);
    expect(page.message).toBe("Response of games is not JSON (text/html): <!doctype html><title>App</title>");
    expect(page).toMatchObject({ status: 200, endpoint: "games", query: "limit 1;" });
    expect(page.cause).toBeInstanceOf(SyntaxError);
  });

  test("400 and 413 are not retried", async () => {
    const bad = mockFetch(() => apicalypseError(400, "Syntax Error"));
    await expect(testClient(bad.fetch).games.limit(1).execute()).rejects.toBeInstanceOf(QueryError);
    expect(bad.calls).toHaveLength(1);
    const big = mockFetch(() => apicalypseError(413, "Payload Too Large", "Response exceeds 10MB limit."));
    await expect(testClient(big.fetch).games.limit(1).execute()).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(big.calls).toHaveLength(1);
  });

  test("an abort signal cancels an in-flight request", async () => {
    let started = false;
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://id.twitch.tv")) {
        return Response.json({ access_token: "t", expires_in: 5_000_000 });
      }
      started = true;
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      );
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    const pending = testClient(fetch).games.limit(1).execute({ signal: controller.signal });
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toBe(true);
    controller.abort(new Error("stop"));
    await expect(pending).rejects.toThrow("stop");
  });

  test("bad Twitch credentials fail fast", async () => {
    const fetch = (async () =>
      Response.json(
        { status: 403, message: "invalid client secret" },
        { status: 403 },
      )) as unknown as typeof globalThis.fetch;
    await expect(testClient(fetch).games.limit(1).execute()).rejects.toBeInstanceOf(AuthError);
  });
});
