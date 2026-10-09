import { describe, expect, test } from "bun:test";
import { createIGDB, IGDBError, LocalLimiter, PayloadTooLargeError, QueryError } from "../../src";
import { igdbProxy, type ProxyOptions } from "../../src/proxy";
import { apicalypseError, type Call, mockFetch, testClient } from "./helpers";

const ORIGIN = "https://app.example";

/** IGDB answers games by id, with an x-count header; a field named "bad" is an Apicalypse error. */
function igdbApi() {
  return mockFetch((call: Call) => {
    if (call.body.includes("bad")) return apicalypseError(400, "Syntax Error", "Invalid field bad");
    if (call.url.endsWith("/games/count")) return Response.json({ count: 42 });
    const ids = [...(call.body.match(/id = \(?([\d,]+)/)?.[1] ?? "1").matchAll(/\d+/g)].map(Number);
    return Response.json(
      ids.map((id) => ({ id, name: `Game ${id}` })),
      { headers: { "x-count": "42" } },
    );
  });
}

/** A browser client whose requests reach the proxy handler, and the server client behind it. */
function setup(options: Omit<ProxyOptions, "igdb"> = {}) {
  const api = igdbApi();
  const handler = igdbProxy({ igdb: testClient(api.fetch), ...options });
  const browserCalls: Request[] = [];
  const browser = createIGDB({
    proxyUrl: "/api/igdb",
    limiter: new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1000, rateLimitPauseMs: 1 }),
    retryTimeoutMs: 200,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(new URL(String(input), ORIGIN), init);
      browserCalls.push(request.clone());
      return handler(request);
    }) as typeof fetch,
  });
  return { api, handler, browser, browserCalls };
}

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/igdb/${path}`, { method: "POST", body, headers });

/** A request whose body never ends, sent in 64-byte chunks, counting the chunks read. */
function endless(path: string, headers: Record<string, string> = {}) {
  const read = { chunks: 0 };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        read.chunks++;
        controller.enqueue(new TextEncoder().encode(" ".repeat(64)));
      },
    },
    { highWaterMark: 0 },
  );
  const init = { method: "POST", body, headers, duplex: "half" };
  return { request: new Request(`${ORIGIN}/api/igdb/${path}`, init as RequestInit), read };
}

describe("browser client through igdbProxy", () => {
  test("queries reach IGDB with the server's credentials only", async () => {
    const { api, browser, browserCalls } = setup();
    const { data, total } = await browser.games
      .select("name")
      .where((g) => g.id.in(1, 2))
      .withCount();
    expect(data).toEqual([
      { id: 1, name: "Game 1" },
      { id: 2, name: "Game 2" },
    ]);
    expect(total).toBe(42);
    expect(browserCalls[0]?.url).toBe(`${ORIGIN}/api/igdb/games`);
    expect(browserCalls[0]?.headers.get("authorization")).toBeNull();
    expect(browserCalls[0]?.headers.get("client-id")).toBeNull();
    expect(api.calls[0]?.headers.authorization).toBe("Bearer token-1");
    expect(api.calls[0]?.headers["client-id"]).toBe("test-client");
    expect(await browser.games.count()).toBe(42);
  });

  test("batched queries go through as one multiquery", async () => {
    const { api, browser } = setup();
    const [a, b] = await Promise.all([
      browser.games.select("name").where((g) => g.id.eq(1)),
      browser.games.select("name").where((g) => g.id.eq(2)),
    ]);
    expect(a).toEqual([{ id: 1, name: "Game 1" }]);
    expect(b).toEqual([{ id: 2, name: "Game 2" }]);
    expect(api.calls.map((c) => c.url)).toEqual(["https://api.igdb.com/v4/multiquery"]);
  });

  test("IGDB's query errors reach the browser as QueryError with their details", async () => {
    const { browser } = setup();
    const error = (await browser.raw("games", "fields bad;").catch((e) => e)) as QueryError;
    expect(error).toBeInstanceOf(QueryError);
    expect(error.details[0]).toMatchObject({ title: "Syntax Error", cause: "Invalid field bad" });
  });

  test("endpoints outside the allowlist are refused, alone or in a multiquery", async () => {
    const { api, browser } = setup({ endpoints: ["games"] });
    const alone = await browser.platforms
      .select("name")
      .execute({ batch: false })
      .catch((e) => e);
    expect(alone).toBeInstanceOf(QueryError);
    expect(alone.message).toContain('Endpoint "platforms" is not available through this proxy');
    const batched = await browser
      .batch({ g: browser.games.select("name"), p: browser.platforms.select("name") })
      .catch((e) => e);
    expect(batched).toBeInstanceOf(QueryError);
    expect(api.calls).toHaveLength(0);
  });

  test("a limit above maxLimit is refused, text inside strings is not", async () => {
    const { api, browser } = setup({ maxLimit: 50 });
    expect(
      await browser.games
        .select("name")
        .limit(51)
        .execute({ batch: false })
        .catch((e) => e),
    ).toBeInstanceOf(QueryError);
    expect(api.calls).toHaveLength(0);
    await browser.raw("games", 'fields name; where name = "limit 900"; limit 50;');
    expect(api.calls).toHaveLength(1);
  });

  test("a batch above maxBodyBytes is split, a query above it fails as PayloadTooLargeError", async () => {
    // Two blocks make a 97-byte multiquery, one block is 26 bytes.
    const { api, browser } = setup({ maxBodyBytes: 60 });
    const [a, b] = await Promise.all([
      browser.games.select("name").where((g) => g.id.eq(1)),
      browser.games.select("name").where((g) => g.id.eq(2)),
    ]);
    expect(a).toEqual([{ id: 1, name: "Game 1" }]);
    expect(b).toEqual([{ id: 2, name: "Game 2" }]);
    expect(api.calls.map((c) => c.url)).toEqual([
      "https://api.igdb.com/v4/games",
      "https://api.igdb.com/v4/games",
    ]);
    const error = (await browser
      .raw("games", `fields name; where name = "${"x".repeat(60)}";`)
      .catch((e) => e)) as PayloadTooLargeError;
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error.message).toBe(
      "Request body too large on games: Refused by proxy: Request body larger than 60 bytes, this proxy's maximum",
    );
  });

  test("authorize() can refuse a request", async () => {
    const { api, browser } = setup({ authorize: (request) => request.headers.has("cookie") });
    expect(
      await browser.games
        .select("name")
        .execute()
        .catch((e) => e),
    ).toBeInstanceOf(QueryError);
    expect(api.calls).toHaveLength(0);
  });

  test("cacheTtlMs keeps answers in the server client's cache", async () => {
    const { api, browser } = setup({ cacheTtlMs: 60_000 });
    await browser.raw("games", "fields name; where id = (1);");
    await browser.raw("games", "fields name; where id = (1);");
    expect(api.calls).toHaveLength(1);
  });
});

describe("igdbProxy requests", () => {
  test("only POST to a known endpoint, never the webhooks API", async () => {
    const { handler } = setup();
    expect((await handler(new Request(`${ORIGIN}/api/igdb/games`))).status).toBe(405);
    expect((await handler(post("games/webhooks", "url=x"))).status).toBe(404);
    expect((await handler(post("nope", "fields *;"))).status).toBe(404);
  });

  test("rejects malformed multiqueries", async () => {
    const { api, handler } = setup({ maxBodyBytes: 100 });
    expect((await handler(post("multiquery", 'query games "a" { fields name;'))).status).toBe(400);
    expect((await handler(post("multiquery", 'fields name; query games "a" { fields name; };'))).status).toBe(
      400,
    );
    const ok = await handler(
      post("multiquery", 'query games "a" { fields name; where platforms = {6,48}; };'),
    );
    expect(ok.status).toBe(200);
    expect(api.calls).toHaveLength(1);
  });

  test("answers 413 to a body above maxBodyBytes, reading no further", async () => {
    const { api, handler } = setup({ maxBodyBytes: 100 });
    const over = await handler(post("games", `fields name; where name = "${"x".repeat(100)}";`));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual([
      {
        title: "Refused by proxy",
        status: 413,
        cause: "Request body larger than 100 bytes, this proxy's maximum",
      },
    ]);
    // Without content-length, reading stops past the limit; with a larger one declared, nothing is read.
    const streamed = endless("games");
    expect((await handler(streamed.request)).status).toBe(413);
    expect(streamed.read.chunks).toBe(2);
    const declared = endless("games", { "content-length": "1000" });
    expect((await handler(declared.request)).status).toBe(413);
    expect(declared.read.chunks).toBe(0);
    // Exactly 100 bytes pass.
    expect((await handler(post("games", `fields name; where name = "${"x".repeat(71)}";`))).status).toBe(200);
    expect(api.calls).toHaveLength(1);
  });

  test("authorize() runs before the body is read", async () => {
    const { handler } = setup({ authorize: () => false });
    const { request, read } = endless("games");
    expect((await handler(request)).status).toBe(403);
    expect(read.chunks).toBe(0);
  });

  test("multiquery can be turned off", async () => {
    const { handler } = setup({ multiquery: false });
    expect((await handler(post("multiquery", 'query games "a" { fields name; };'))).status).toBe(403);
  });

  test("CORS: preflight and headers for allowed origins only", async () => {
    const { handler } = setup({ allowOrigin: [ORIGIN] });
    const preflight = await handler(
      new Request(`${ORIGIN}/api/igdb/games`, { method: "OPTIONS", headers: { origin: ORIGIN } }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const ok = await handler(post("games", "fields name;", { origin: ORIGIN }));
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-expose-headers")).toBe("X-Count");
    const other = await handler(post("games", "fields name;", { origin: "https://evil.example" }));
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a failure of the proxy's own credentials is a 502, not a 401", async () => {
    const handler = igdbProxy({
      igdb: testClient(mockFetch(() => new Response("{}", { status: 401 })).fetch, {
        clientSecret: undefined,
        accessToken: "revoked",
      }),
    });
    const res = await handler(post("games", "fields name;"));
    expect(res.status).toBe(502);
  });

  test("needs a client made by createIGDB()", () => {
    expect(() => igdbProxy({ igdb: {} as never })).toThrow(IGDBError);
  });
});

describe("createIGDB in a browser", () => {
  test("refuses credentials but accepts proxyUrl", () => {
    const global = globalThis as { document?: unknown };
    global.document = {};
    try {
      expect(() => createIGDB({ clientId: "a", clientSecret: "b" })).toThrow(/proxyUrl/);
      expect(() => createIGDB({ proxyUrl: "/api/igdb" })).not.toThrow();
    } finally {
      delete global.document;
    }
  });
});
