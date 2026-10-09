import { describe, expect, test } from "bun:test";
import { PopularityType, QueryError } from "../../src";
import { type Call, mockFetch, testClient } from "./helpers";

// 1000 popularity rows for games 1..1000, most popular first. Games go up to 30,000: even ids are
// released (game_status = 0), one in 13 is on platform 508, none on platform 999.
const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, game_id: i + 1, value: 1 - i / 1000 }));
const GAMES = 30_000;

function matches(body: string, id: number): boolean {
  if (body.includes("game_status = 0") && id % 2 !== 0) return false;
  if (body.includes("platforms = (508)") && id % 13 !== 0) return false;
  if (body.includes("platforms = (999)")) return false;
  return true;
}

function api() {
  return mockFetch((call: Call) => {
    const body = call.body;
    const limit = Number(body.match(/limit (\d+);/)?.[1] ?? 10);
    const offset = Number(body.match(/offset (\d+);/)?.[1] ?? 0);
    if (call.url.endsWith("/popularity_primitives")) {
      const games = body
        .match(/game_id = \(([^)]*)\)/)?.[1]
        ?.split(",")
        .map(Number);
      const found = games ? rows.filter((r) => games.includes(r.game_id)) : rows;
      return Response.json(found.slice(offset, offset + limit));
    }
    const all = Array.from({ length: GAMES }, (_, i) => i + 1).filter((id) => matches(body, id));
    if (call.url.endsWith("/games/count")) return Response.json({ count: all.length });
    const ids = body
      .match(/id = \(([^)]*)\)/)?.[1]
      ?.split(",")
      .map(Number);
    // IGDB returns games in its own order, not the requested one.
    if (ids)
      return Response.json(
        all
          .filter((id) => ids.includes(id))
          .reverse()
          .map((id) => ({ id, name: `game ${id}` })),
      );
    return Response.json(all.slice(offset, offset + limit).map((id) => ({ id })));
  });
}

const popularityCalls = (calls: Call[]) => calls.filter((c) => c.body.includes("popularity_type"));

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

  test("ranks equal values by id", async () => {
    const tied = [
      { id: 1, game_id: 7, value: 0.5 },
      { id: 2, game_id: 3, value: 0.5 },
      { id: 3, game_id: 9, value: 0.4 },
    ];
    const mock = mockFetch((call: Call) =>
      call.url.endsWith("/popularity_primitives")
        ? Response.json(tied)
        : Response.json(tied.map((r) => ({ id: r.game_id }))),
    );
    const top = await testClient(mock.fetch).games.popular(PopularityType.IGDBVisits, { limit: 3 });
    expect(top.map((t) => t.game.id)).toEqual([3, 7, 9]);
  });

  test("a where matching many games scans popularity rows until limit is reached", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const top = await igdb.games
      .select("name")
      .where((g) => g.game_status.eq(0))
      .popular(PopularityType.IGDBVisits, { limit: 300 });
    expect(top).toHaveLength(300);
    expect(top.map((t) => t.game.id)).toEqual(Array.from({ length: 300 }, (_, i) => (i + 1) * 2));
    // 15,000 games match: the count says so, then two pages of rows.
    expect(popularityCalls(mock.calls)).toHaveLength(2);
  });

  test("a where matching few games reads their own rows when the first page is not enough", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const top = await igdb.games
      .select("name")
      .where((g) => g.platforms.any(508))
      .popular(PopularityType.IGDBVisits, { limit: 50, maxRows: 500 });
    // 2,307 games match and 76 of them have a row: the 50 best, where the first 500 rows hold 38.
    expect(top.map((t) => t.game.id)).toEqual(Array.from({ length: 50 }, (_, i) => (i + 1) * 13));
    expect(top[0]).toEqual({ game: { id: 13, name: "game 13" }, value: 0.988 });
    const lines = mock.calls.flatMap((c) => c.body.split("\n"));
    expect(lines.filter((b) => b.includes("offset 500;") && b.includes("popularity_type"))).toEqual([]);
    const own = lines.filter((b) => b.includes("game_id = ("));
    expect(own).toHaveLength(5); // one list of 500 ids per block
    expect(own.every((b) => b.includes("limit 50;"))).toBe(true);
    // The first page with the count and first ids, its games, the other ids, the rows, the 12 new games.
    expect(mock.calls).toHaveLength(5);
    expect(mock.calls[4]?.body).toBe(
      `fields name; where (platforms = (508)) & (id = (${Array.from({ length: 12 }, (_, i) => (i + 39) * 13).join(",")})); limit 12;`,
    );
  });

  test("a where whose first page is enough, or that matches nothing, reads nothing more", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const top = await igdb.games.where((g) => g.platforms.any(508)).popular(PopularityType.IGDBVisits);
    expect(top.map((t) => t.game.id)).toEqual(Array.from({ length: 10 }, (_, i) => (i + 1) * 13));
    // The first page with the count and first ids, then its games.
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]?.body.split("\n")).toHaveLength(3);

    const none = api();
    const empty = testClient(none.fetch).games.where((g) => g.platforms.any(999));
    expect(await empty.popular(PopularityType.IGDBVisits)).toEqual([]);
    expect(none.calls).toHaveLength(1);
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
