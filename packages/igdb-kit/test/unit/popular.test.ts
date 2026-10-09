import { describe, expect, test } from "bun:test";
import { PopularityType, QueryError } from "../../src";
import { mockFetch, testClient } from "./helpers";

// 1000 popularity rows for games 1..1000, most popular first; even ids are released games.
const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, game_id: i + 1, value: 1 - i / 1000 }));

function api() {
  return mockFetch((call) => {
    if (call.url.endsWith("/popularity_primitives")) {
      const limit = Number(call.body.match(/limit (\d+);/)?.[1]);
      const offset = Number(call.body.match(/offset (\d+);/)?.[1] ?? 0);
      return Response.json(rows.slice(offset, offset + limit));
    }
    const ids = (call.body.match(/id = \(([^)]*)\)/)?.[1] ?? "").split(",").map(Number);
    const evenOnly = call.body.includes("game_status = 0");
    // IGDB returns games in its own order, not the requested one.
    const games = ids.filter((id) => !evenOnly || id % 2 === 0).reverse();
    return Response.json(games.map((id) => ({ id, name: `game ${id}` })));
  });
}

describe("popular()", () => {
  test("returns games in popularity order with their score", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const top = await igdb.games.select("name").popular(PopularityType.IGDBPlaying, { limit: 3 });
    expect(top).toEqual([
      { game: { id: 1, name: "game 1" }, value: 1 },
      { game: { id: 2, name: "game 2" }, value: 0.999 },
      { game: { id: 3, name: "game 3" }, value: 0.998 },
    ]);
    const primitives = mock.calls.find((c) => c.url.endsWith("/popularity_primitives"));
    expect(primitives?.body).toBe(
      "fields game_id,value; where popularity_type = 3; sort value desc; limit 13; offset 0;",
    );
  });

  test("applies the query's where to the games and reads more rows until limit is reached", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const top = await igdb.games
      .select("name")
      .where((g) => g.game_status.eq(0))
      .popular(PopularityType.IGDBVisits, { limit: 300 });
    expect(top).toHaveLength(300);
    expect(top.map((t) => t.game.id)).toEqual(Array.from({ length: 300 }, (_, i) => (i + 1) * 2));
    expect(mock.calls.filter((c) => c.body.includes("popularity_type")).length).toBe(2);
  });

  test("stops at maxRows and at the end of the table", async () => {
    const igdb = testClient(api().fetch);
    const filtered = igdb.games.where((g) => g.game_status.eq(0));
    expect(await filtered.popular(PopularityType.IGDBVisits, { limit: 500, maxRows: 500 })).toHaveLength(250);
    expect(await filtered.popular(PopularityType.IGDBVisits, { limit: 500, maxRows: 10_000 })).toHaveLength(
      500,
    );
  });

  test("validates its input", async () => {
    const igdb = testClient(api().fetch);
    await expect(igdb.games.popular(PopularityType.IGDBVisits, { limit: 0 })).rejects.toThrow(QueryError);
    await expect(igdb.games.search("zelda").popular(PopularityType.IGDBVisits)).rejects.toThrow(/search/);
    // @ts-expect-error only on games
    await expect(igdb.platforms.popular(PopularityType.IGDBVisits)).rejects.toThrow(/only on games/);
  });
});
