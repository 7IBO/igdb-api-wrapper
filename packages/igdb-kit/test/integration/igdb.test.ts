// Runs against the real IGDB API. Skipped unless TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set.
// Uses about 10 requests.
import { describe, expect, test } from "bun:test";
import { createIGDB, QueryError, TierError } from "../../src";

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;

describe.skipIf(!clientId || !clientSecret)("real IGDB API", () => {
  const igdb = createIGDB({ clientId: clientId ?? "", clientSecret: clientSecret ?? "" });

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
});
