import { createIGDB, type IGDBServerClientOptions, LocalLimiter } from "../../src";

export interface Call {
  url: string;
  body: string;
  headers: Record<string, string>;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** A fake fetch: the Twitch token endpoint always succeeds, IGDB calls go to `handler`. */
export function mockFetch(handler: Handler, onMultiquery?: (call: Call) => Response | undefined) {
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
    if (url.endsWith("/multiquery")) return onMultiquery?.(call) ?? emulateMultiquery(call, handler);
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

export function testClient(fetch: typeof globalThis.fetch, options: Partial<IGDBServerClientOptions> = {}) {
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

/** Answers a multiquery by running each block through the single-query handler, like IGDB does. */
async function emulateMultiquery(call: Call, handler: Handler): Promise<Response> {
  const blocks = [...call.body.matchAll(/query (\S+) "([^"]+)" \{ (.*?) \};/g)];
  const out: unknown[] = [];
  for (const [, path, name, body] of blocks) {
    const res = await handler({
      url: call.url.replace(/multiquery$/, path as string),
      body: body as string,
      headers: call.headers,
    });
    if (!res.ok) return res; // IGDB fails the whole multiquery
    const data = await res.json();
    out.push((path as string).endsWith("/count") ? { name, count: data.count } : { name, result: data });
  }
  return Response.json(out);
}

type Row = Record<string, unknown> & { id: number };

/** The table each relation field points to. */
const targets: Record<string, string> = {
  game: "games",
  games: "games",
  bundles: "games",
  parent_game: "games",
  version_parent: "games",
  collection: "collections",
  company: "companies",
  parent: "companies",
};

/**
 * A small IGDB over in-memory tables that follows relations: `where` with `path = (ids)`, `path =
 * value` and `id > n` joined by `&` and `|` (`collection.games = (1)` reads the collection's games),
 * `fields` with expanded paths (`game.name`), `sort id asc`, `limit` and `/count`.
 */
export function relationalFake(tables: Record<string, Row[]>) {
  const byId = (table: string, id: unknown) => tables[table]?.find((row) => row.id === id);
  const values = (row: Row, path: string): unknown[] => {
    const [head, ...rest] = path.split(".");
    const value = row[head as string];
    const list = (Array.isArray(value) ? value : value === undefined ? [] : [value]) as unknown[];
    if (rest.length === 0) return list;
    return list.flatMap((id) => {
      const target = byId(targets[head as string] ?? "", id);
      return target ? values(target, rest.join(".")) : [];
    });
  };
  const project = (row: Row, fields: string[], table: string): Row => {
    if (fields.includes("*")) return row;
    const out: Row = { id: row.id };
    for (const head of new Set(fields.map((f) => f.split(".")[0] as string))) {
      if (row[head] === undefined) continue;
      const inner = fields.filter((f) => f.startsWith(`${head}.`)).map((f) => f.slice(head.length + 1));
      if (inner.length === 0) {
        out[head] = row[head];
        continue;
      }
      const expand = (id: unknown) => {
        const target = byId(targets[head] ?? "", id);
        return target ? project(target, inner, targets[head] ?? table) : undefined;
      };
      const value = row[head];
      out[head] = Array.isArray(value) ? value.map(expand).filter(Boolean) : expand(value);
    }
    return out;
  };
  return mockFetch((call: Call) => {
    const path = call.url.split("/v4/")[1] ?? "";
    const [endpoint, count] = path.split("/") as [string, string | undefined];
    let rows = tables[endpoint] ?? [];
    const where = call.body.match(/where (.*?);/)?.[1];
    if (where) {
      const code = where
        .replace(/([\w.]+) = \(([^)]*)\)/g, 'H(r,"$1",[$2])')
        .replace(/([\w.]+) = (true|false|\d+)/g, 'H(r,"$1",[$2])')
        .replace(/id > (-?\d+)/g, "(r.id > $1)")
        .replaceAll("&", "&&")
        .replaceAll("|", "||");
      const has = (row: Row, field: string, wanted: unknown[]) =>
        values(row, field).some((v) => wanted.includes(v));
      const test = new Function("H", "r", `return ${code};`) as (h: typeof has, row: Row) => boolean;
      rows = rows.filter((row) => test(has, row));
    }
    if (count) return Response.json({ count: rows.length });
    if (call.body.includes("sort id asc")) rows = [...rows].sort((a, b) => a.id - b.id);
    rows = rows.slice(0, Number(call.body.match(/limit (\d+);/)?.[1] ?? 10));
    const fields = call.body.match(/fields (.*?);/)?.[1]?.split(",") ?? ["id"];
    return Response.json(rows.map((row) => project(row, fields, endpoint)));
  });
}
