import { describe, expect, test } from "bun:test";
import { createIGDB, LocalLimiter, PayloadTooLargeError, QueryError } from "../../src";
import { apicalypseError, type Call, mockFetch, testClient } from "./helpers";

const echoIds = mockFetch((call) => {
  const id = Number(call.body.match(/id = (\d+)/)?.[1] ?? 0);
  return Response.json([{ id, name: `game ${id}` }]);
});

describe("automatic batching", () => {
  test("queries started together share multiqueries of 10 blocks", async () => {
    const mock = mockFetch((call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]));
    const igdb = testClient(mock.fetch);
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const games = await Promise.all(ids.map((id) => igdb.games.select("name").findById(id)));
    expect(games.map((g) => g?.id)).toEqual(ids);
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["multiquery", "multiquery", "multiquery"]);
    expect(mock.calls.map((c) => c.body.split("\n").length).sort()).toEqual([10, 10, 5]);
  });

  test("a single query is sent on its own endpoint", async () => {
    const igdb = testClient(echoIds.fetch);
    const before = echoIds.calls.length;
    await igdb.games.findById(5);
    expect(echoIds.calls[before]?.url).toEndWith("/games");
  });

  test("counts and lists mix in one multiquery", async () => {
    const mock = mockFetch((call) =>
      call.url.endsWith("/count") ? Response.json({ count: 42 }) : Response.json([{ id: 1, name: "a" }]),
    );
    const igdb = testClient(mock.fetch);
    const result = await igdb.batch({
      top: igdb.games.select("name").limit(1),
      total: igdb.games.where((g) => g.rating.gt(90)).count(),
      first: igdb.platforms.select("name").first(),
    });
    expect(result).toEqual({ top: [{ id: 1, name: "a" }], total: 42, first: { id: 1, name: "a" } });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.body).toContain('query games/count "');
  });

  test("identical queries are sent once", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const igdb = testClient(mock.fetch);
    const q = igdb.games.select("name").limit(1);
    await Promise.all([q.execute(), q.execute(), igdb.games.select("name").limit(1).execute()]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url).toEndWith("/games");
  });

  test("search queries are never put in a multiquery", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const igdb = testClient(mock.fetch);
    await Promise.all([
      igdb.games.search("zelda").limit(1).execute(),
      igdb.games.findById(1),
      igdb.games.findById(2),
    ]);
    const paths = mock.calls.map((c) => c.url.split("/").pop()).sort();
    expect(paths).toEqual(["games", "multiquery"]);
    expect(mock.calls.find((c) => c.url.endsWith("/multiquery"))?.body).not.toContain("search");
  });

  test("an invalid block only fails its own query", async () => {
    const mock = mockFetch((call) =>
      call.body.includes("id = 3")
        ? apicalypseError(400, "Invalid Field", "Invalid field name: 'x'")
        : Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]),
    );
    const igdb = testClient(mock.fetch);
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((id) => igdb.games.findById(id).execute()));
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect((results[2] as PromiseRejectedResult).reason).toBeInstanceOf(QueryError);
  });

  test("a too large response is split until it fits", async () => {
    const mock = mockFetch(
      () => Response.json([{ id: 1 }]),
      (call) =>
        call.body.split("\n").length > 2
          ? apicalypseError(413, "Payload Too Large", "Response exceeds 10MB limit.")
          : undefined,
    );
    const igdb = testClient(mock.fetch);
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((id) => igdb.games.findById(id)));
    expect(results).toHaveLength(6);
    // 6 blocks -> 413, then 3 + 3 -> 413, then 2 + 1 + 2 + 1 -> ok.
    expect(mock.calls).toHaveLength(7);
  });

  test("a single block that is too large rejects with PayloadTooLargeError", async () => {
    const mock = mockFetch(() => apicalypseError(413, "Payload Too Large", "Response exceeds 10MB limit."));
    const igdb = testClient(mock.fetch);
    await expect(igdb.games.select("*").limit(500).execute()).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  test("batches are sized by estimated response size", async () => {
    const mock = mockFetch(() => Response.json([]));
    const igdb = testClient(mock.fetch, { maxBatchBytes: 1_000_000 });
    // Expanded fields on 500 games are estimated far above 1 MB, so each query goes alone.
    await Promise.all(
      [1, 2, 3].map((i) =>
        igdb.games.select("*", "cover.*", "platforms.*").where(`id > ${i}`).limit(500).execute(),
      ),
    );
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["games", "games", "games"]);
  });

  test("batches are cut before IGDB's body limit", async () => {
    const mock = mockFetch((call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]));
    const igdb = testClient(mock.fetch);
    // Ten queries of about 5,000 bytes: 50 KB in one multiquery would be refused (413).
    const long = (id: number) => igdb.games.where(`id = ${id} & name != "${"x".repeat(5_000)}"`).first();
    const games = await Promise.all(Array.from({ length: 10 }, (_, i) => long(i + 1)));
    expect(games.map((g) => g?.id)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    const sizes = mock.calls.map((c) => new TextEncoder().encode(c.body).length);
    expect(sizes.every((size) => size <= 32_000)).toBe(true);
    expect(mock.calls.map((c) => c.body.split("\n").length)).toEqual([6, 4]);
  });

  test("through a proxy, batches stay under its 16 KB default, or the limit given", async () => {
    const answer = (call: Call) => Response.json([{ id: Number(call.body.match(/id = (\d+)/)?.[1]) }]);
    for (const [maxBodyBytes, blocks] of [
      [undefined, [3, 3, 3, 1]],
      [32_000, [6, 4]],
    ] as const) {
      const mock = mockFetch(answer);
      const igdb = createIGDB({
        proxyUrl: "https://app.example/api/igdb",
        fetch: mock.fetch,
        limiter: new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1000 }),
        maxBodyBytes,
      });
      const long = (id: number) => igdb.games.where(`id = ${id} & name != "${"x".repeat(5_000)}"`).first();
      await Promise.all(Array.from({ length: 10 }, (_, i) => long(i + 1)));
      expect(mock.calls.map((c) => c.body.split("\n").length)).toEqual([...blocks]);
    }
  });

  test("autoBatch: false sends queries alone, but batch() still groups them", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const igdb = testClient(mock.fetch, { autoBatch: false });
    await Promise.all([igdb.games.findById(1), igdb.games.findById(2)]);
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["games", "games"]);
    await igdb.batch({ a: igdb.games.findById(1), b: igdb.games.findById(2) });
    expect(mock.calls[2]?.url).toEndWith("/multiquery");
  });

  test("withCount is never batched (x-count only exists on single requests)", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }], { headers: { "x-count": "7" } }));
    const igdb = testClient(mock.fetch);
    const [page] = await Promise.all([igdb.games.limit(1).withCount(), igdb.games.findById(9)]);
    expect(page.total).toBe(7);
    expect(mock.calls.every((c) => c.url.endsWith("/games"))).toBe(true);
  });

  test("an aborted caller stops waiting without cancelling the shared request", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const igdb = testClient(mock.fetch);
    const controller = new AbortController();
    const q = igdb.games.findById(1);
    const aborted = q.execute({ signal: controller.signal });
    const other = q.execute();
    controller.abort(new Error("stop"));
    await expect(aborted).rejects.toThrow("stop");
    expect(await other).toEqual({ id: 1 });
  });
});
