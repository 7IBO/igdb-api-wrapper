import { describe, expect, test } from "bun:test";
import { type CacheStore, memoryCache, QueryError } from "../../src";
import { mockFetch, testClient } from "./helpers";

const games = () => mockFetch(() => Response.json([{ id: 1, name: "a" }]));

describe("cache", () => {
  test("cache() serves identical queries from the store", async () => {
    const mock = games();
    const igdb = testClient(mock.fetch);
    const query = igdb.games.select("name").limit(1).cache(60_000);
    expect(await query).toEqual([{ id: 1, name: "a" }]);
    expect(await query).toEqual([{ id: 1, name: "a" }]);
    expect(await igdb.games.select("name").limit(1).cache(60_000).first()).toEqual({ id: 1, name: "a" });
    expect(mock.calls).toHaveLength(1); // first() sends the same body as limit(1): same cache entry
  });

  test("queries without cache() are not cached", async () => {
    const mock = games();
    const igdb = testClient(mock.fetch);
    await igdb.games.select("name");
    await igdb.games.select("name");
    expect(mock.calls).toHaveLength(2);
  });

  test("cacheTtlMs caches everything, cache(false) opts out", async () => {
    const mock = games();
    const igdb = testClient(mock.fetch, { cacheTtlMs: 60_000 });
    await igdb.games.select("name");
    await igdb.games.select("name");
    expect(mock.calls).toHaveLength(1);
    await igdb.games.select("name").cache(false);
    expect(mock.calls).toHaveLength(2);
  });

  test("withCount keeps its total from the cache", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1 }], { headers: { "x-count": "99" } }));
    const igdb = testClient(mock.fetch);
    const query = igdb.games.limit(1).cache(60_000).withCount();
    expect(await query).toEqual({ data: [{ id: 1 }], total: 99 });
    expect(await query).toEqual({ data: [{ id: 1 }], total: 99 });
    expect(mock.calls).toHaveLength(1);
  });

  test("a failing store never fails the query", async () => {
    const broken: CacheStore = {
      get: () => Promise.reject(new Error("down")),
      set: () => Promise.reject(new Error("down")),
    };
    const mock = games();
    const igdb = testClient(mock.fetch, { cache: broken });
    expect(await igdb.games.select("name").cache(1000)).toEqual([{ id: 1, name: "a" }]);
  });

  test("cache() rejects invalid durations", () => {
    const igdb = testClient(games().fetch);
    expect(() => igdb.games.cache(0)).toThrow(QueryError);
  });
});

describe("memoryCache", () => {
  test("expires entries and evicts the least recently used", async () => {
    const cache = memoryCache({ maxEntries: 2 });
    await cache.set("a", "1", 60_000);
    await cache.set("b", "2", 60_000);
    await cache.get("a");
    await cache.set("c", "3", 60_000);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe("1");
    await cache.set("d", "4", 1);
    await Bun.sleep(5);
    expect(await cache.get("d")).toBeUndefined();
  });

  test("keeps maxBytes of entries at most, and none above a quarter of it", async () => {
    const cache = memoryCache({ maxBytes: 100 });
    const value = "x".repeat(19); // 20 with its key
    for (const key of ["a", "b", "c", "d", "e"]) await cache.set(key, value, 60_000);
    await cache.get("a");
    await cache.set("b", "y".repeat(19), 60_000); // replaced, not counted twice
    expect(await cache.get("c")).toBe(value);
    await cache.set("f", value, 60_000); // 120: the least recently used, d, goes
    expect(await cache.get("d")).toBeUndefined();
    expect(await cache.get("a")).toBe(value);
    await cache.set("g", "x".repeat(25), 60_000); // 26: not kept, and pushes nothing out
    expect(await cache.get("g")).toBeUndefined();
    for (const key of ["a", "b", "c", "e", "f"]) expect(await cache.get(key)).toBeDefined();
  });

  test("an expired entry frees its bytes", async () => {
    const cache = memoryCache({ maxBytes: 100 });
    await cache.set("a", "x".repeat(24), 1);
    await Bun.sleep(5);
    expect(await cache.get("a")).toBeUndefined();
    for (const key of ["b", "c", "d", "e"]) await cache.set(key, "x".repeat(24), 60_000);
    for (const key of ["b", "c", "d", "e"]) expect(await cache.get(key)).toBeDefined();
  });
});
