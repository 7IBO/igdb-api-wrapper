// Runs against the real IGDB API. Skipped unless TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set.
// Uses about 20 requests. The webhook test registers webhooks on example.com and removes them.
import { describe, expect, test } from "bun:test";
import { createIGDB, QueryError, TierError } from "../../src";

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;

// The describe body runs even when skipped, so only build the client when credentials exist.
const igdb = clientId && clientSecret ? createIGDB({ clientId, clientSecret }) : (undefined as never);

describe.skipIf(!clientId || !clientSecret)("real IGDB API", () => {
  test("select with expansions returns the inferred shape", async () => {
    const game = await igdb.games.select("name", "cover.image_id", "platforms.name", "genres").findById(1942);
    expect(game?.name).toBe("The Witcher 3: Wild Hunt");
    expect(typeof game?.cover?.image_id).toBe("string");
    expect(game?.platforms?.every((p) => typeof p.id === "number" && typeof p.name === "string")).toBe(true);
    expect(game?.genres?.every((g) => typeof g === "number")).toBe(true);
  });

  test("typed where, sort and limit", async () => {
    const games = await igdb.games
      .select("name", "rating")
      .where((g) => g.rating.gte(90).and(g.rating_count.gte(100)))
      .sort("rating", "desc")
      .limit(5);
    expect(games).toHaveLength(5);
    expect(games.every((g) => (g.rating ?? 0) >= 90)).toBe(true);
  });

  test("count and withCount agree", async () => {
    const query = igdb.games.where((g) => g.rating.gte(95));
    const [count, page] = await Promise.all([query.count(), query.limit(1).withCount()]);
    expect(count).toBeGreaterThan(0);
    expect(page.total).toBe(count);
  });

  test("search", async () => {
    const games = await igdb.games.select("name").search("zelda").limit(5);
    expect(games.length).toBeGreaterThan(0);
  });

  test("findByIds keeps the requested order", async () => {
    const games = await igdb.games.select("name").findByIds([1020, 1942, 7346]);
    expect(games.map((g) => g.id)).toEqual([1020, 1942, 7346]);
  });

  test("iterate walks a whole small endpoint", async () => {
    const ids: number[] = [];
    for await (const genre of igdb.genres.select("name").iterate({ pageSize: 10 })) ids.push(genre.id);
    expect(ids.length).toBeGreaterThan(15);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  test("typed errors", async () => {
    await expect(igdb.raw("games", "fields nope;")).rejects.toBeInstanceOf(QueryError);
    await expect(igdb.content_safety_ratings.limit(1).execute()).rejects.toBeInstanceOf(TierError);
  });

  test("batch() sends typed queries in one multiquery", async () => {
    const { top, total, ps5 } = await igdb.batch({
      top: igdb.games
        .select("name")
        .where((g) => g.rating_count.gt(500))
        .sort("rating", "desc")
        .limit(3),
      total: igdb.games.count(),
      ps5: igdb.platforms.select("name").findById(167),
    });
    expect(top).toHaveLength(3);
    expect(total).toBeGreaterThan(100_000);
    expect(ps5?.name).toBe("PlayStation 5");
  });

  test("an invalid query in a batch only fails itself", async () => {
    const results = await Promise.allSettled([
      igdb.games.findById(1942).execute(),
      igdb.games.where("nope = 1").limit(1).execute(),
      igdb.platforms.findById(6).execute(),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(QueryError);
  });

  test("sync reads every entity once, in id order", async () => {
    const seen: number[] = [];
    for await (const page of igdb.platforms.select("name").sync()) seen.push(...page.map((p) => p.id));
    expect(seen.length).toBe(await igdb.platforms.count());
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  test("webhooks: register, list, re-register and delete", async () => {
    const url = `https://example.com/igdb-kit-ci/${crypto.randomUUID()}`;
    const hooks = await igdb.webhooks.ensure({ url, secret: "ci-secret", endpoints: ["platforms"] });
    try {
      expect(hooks.map((h) => h.operation).sort()).toEqual(["create", "delete", "update"]);
      expect(hooks.every((h) => h.active && h.url.startsWith(url))).toBe(true);
      const again = await igdb.webhooks.register("platforms", {
        url: hooks[0]?.url as string,
        secret: "ci-secret",
        operation: hooks[0]?.operation as "create",
      });
      expect(again.id).toBe(hooks[0]?.id as number);
      const listed = await igdb.webhooks.list();
      expect(hooks.every((h) => listed.some((l) => l.id === h.id))).toBe(true);
      expect((await igdb.webhooks.get(hooks[1]?.id as number))?.url).toBe(hooks[1]?.url as string);
    } finally {
      await Promise.all(hooks.map((h) => igdb.webhooks.delete(h.id)));
    }
    const after = await igdb.webhooks.list();
    expect(after.some((l) => hooks.some((h) => h.id === l.id))).toBe(false);
  });
});
