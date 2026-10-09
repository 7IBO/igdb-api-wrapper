import { describe, expect, test } from "bun:test";
import { PopularityType, QueryError } from "../../src";
import { rankRows } from "../../src/query/popularity";
import { type Call, mockFetch, testClient } from "./helpers";

interface Row {
  id: number;
  game_id: number;
  popularity_type: number;
  value: number;
  calculated_at?: number;
  external_popularity_source?: number;
}

/**
 * Answers popularity_primitives like IGDB: by type in value or id order with limit/offset, by id
 * range, or by game ids; counted too, `staleCount` short when rows were added since. Games: ids 1 to
 * `games` (20,000 by default) but `deleted`, filtered by `game_status = 0` to ids above
 * `filterAbove`; counted, listed by id, or looked up by ids.
 */
function api(
  rows: Row[],
  options: { deleted?: number[]; filterAbove?: number; games?: number; staleCount?: number } = {},
) {
  return mockFetch((call: Call) => {
    const body = call.body;
    if (call.url.includes("/popularity_primitives")) {
      const limit = Number(body.match(/limit (\d+);/)?.[1] ?? 10);
      const offset = Number(body.match(/offset (\d+);/)?.[1] ?? 0);
      const games = body
        .match(/game_id = \(([^)]*)\)/)?.[1]
        ?.split(",")
        .map(Number);
      const types = (body.match(/popularity_type = \(?([\d,]+)\)?/)?.[1] ?? "").split(",").map(Number);
      const after = Number(body.match(/id > (-?\d+)/)?.[1] ?? -1);
      const before = Number(body.match(/id < (\d+)/)?.[1] ?? Number.POSITIVE_INFINITY);
      let matches = rows.filter((r) => types.includes(r.popularity_type) && r.id > after && r.id < before);
      if (games) matches = matches.filter((r) => games.includes(r.game_id));
      if (call.url.endsWith("/count")) {
        return Response.json({ count: Math.max(0, matches.length - (options.staleCount ?? 0)) });
      }
      matches.sort(
        body.includes("sort value desc")
          ? (a, b) => b.value - a.value
          : body.includes("sort id desc")
            ? (a, b) => b.id - a.id
            : (a, b) => a.id - b.id,
      );
      return Response.json(matches.slice(offset, offset + limit));
    }
    const filtered = body.includes("game_status = 0");
    const exists = (id: number) =>
      !options.deleted?.includes(id) && (!filtered || id > (options.filterAbove ?? 0));
    const all = Array.from({ length: options.games ?? 20_000 }, (_, i) => i + 1).filter(exists);
    if (call.url.endsWith("/games/count")) return Response.json({ count: all.length });
    const ids = body
      .match(/id = \(([^)]*)\)/)?.[1]
      ?.split(",")
      .map(Number);
    if (!ids) {
      const limit = Number(body.match(/limit (\d+);/)?.[1] ?? 10);
      const offset = Number(body.match(/offset (\d+);/)?.[1] ?? 0);
      return Response.json(all.slice(offset, offset + limit).map((id) => ({ id })));
    }
    const found = ids.filter(exists);
    return Response.json(found.reverse().map((id) => ({ id, name: `game ${id}` })));
  });
}

const rowsOf = (type: number, values: [game: number, value: number][], firstId = type * 100_000) =>
  values.map(([game_id, value], i) => ({ id: firstId + i, game_id, popularity_type: type, value }));

// Real scales: Want to Play tops at about 0.002, Playing at about 0.007.
const small = [
  ...rowsOf(PopularityType.IGDBWantToPlay, [
    [10, 0.002],
    [20, 0.001],
    [30, 0.0005],
  ]),
  ...rowsOf(PopularityType.IGDBPlaying, [
    [20, 0.007],
    [40, 0.0035],
    [30, 0], // measured 0, not missing
  ]),
];

describe("weightedPopular()", () => {
  test("scales each type by its top value, and keeps a missing row (null) apart from 0", async () => {
    const igdb = testClient(api(small).fetch);
    const top = await igdb.games
      .select("name")
      .weightedPopular({ [PopularityType.IGDBWantToPlay]: 0.5, [PopularityType.IGDBPlaying]: 0.5 });
    expect(top.map((t) => [t.game.id, t.score])).toEqual([
      [20, 0.75],
      [10, 0.5],
      [40, 0.25],
      [30, 0.125],
    ]);
    expect(top[0]?.game).toEqual({ id: 20, name: "game 20" });
    expect(top[1]?.values).toEqual({ 2: 0.002, 3: null });
    expect(top[3]?.values).toEqual({ 2: 0.0005, 3: 0 });
  });

  test("reads more rounds until the top is settled, applying the query's where", async () => {
    // 2000 games ranked 1..2000; only games above 1200 pass the filter, 18,800 of the 20,000.
    const rows = rowsOf(
      PopularityType.IGDBVisits,
      Array.from({ length: 2000 }, (_, i) => [i + 1, (2000 - i) / 1e6] as [number, number]),
    );
    const mock = api(rows, { filterAbove: 1200 });
    const igdb = testClient(mock.fetch);
    const query = igdb.games.where((g) => g.game_status.eq(0)).limit(3);
    const top = await query.weightedPopular({ [PopularityType.IGDBVisits]: 1 });
    expect(top.map((t) => t.game.id)).toEqual([1201, 1202, 1203]);
    const scans = (m: typeof mock) =>
      m.calls.flatMap(
        (c) => c.body.match(/popularity_type = 1; sort value desc; limit 500; offset \d+/g) ?? [],
      );
    expect(scans(mock)).toHaveLength(3); // offsets 0, 500, 1000: rows 1001-1500 settle it

    const capped = api(rows, { filterAbove: 1200 });
    const none = await testClient(capped.fetch)
      .games.where((g) => g.game_status.eq(0))
      .limit(3)
      .weightedPopular({ [PopularityType.IGDBVisits]: 1 }, { maxRows: 1000 });
    expect(none).toEqual([]);
    expect(scans(capped)).toHaveLength(2);
  });

  test("a where matching few games scores their own rows: exact, past maxRows", async () => {
    // The same 2000 ranked games, but only 2,500 games exist: the 1,300 above 1200 pass the filter.
    const visits = rowsOf(
      PopularityType.IGDBVisits,
      Array.from({ length: 2000 }, (_, i) => [i + 1, (2000 - i) / 1e6] as [number, number]),
    );
    const playing = rowsOf(PopularityType.IGDBPlaying, [
      [1300, 0.007],
      [5, 0.006],
    ]);
    const mock = api([...visits, ...playing], { filterAbove: 1200, games: 2500 });
    const top = await testClient(mock.fetch)
      .games.select("name")
      .where((g) => g.game_status.eq(0))
      .limit(3)
      .weightedPopular(
        { [PopularityType.IGDBVisits]: 0.5, [PopularityType.IGDBPlaying]: 0.5 },
        { maxRows: 500 },
      );
    // Each type scales to its top over every game: Visits to 0.002 (game 1), Playing to 0.007.
    expect(top.map((t) => t.game.id)).toEqual([1300, 1201, 1202]);
    const scores = [
      0.5 * (0.000701 / 0.002) + 0.5 * (0.007 / 0.007),
      0.5 * (0.0008 / 0.002),
      0.5 * (0.000799 / 0.002),
    ];
    for (const [i, entry] of top.entries()) expect(entry.score).toBeCloseTo(scores[i] as number, 12);
    expect(top[0]).toMatchObject({
      game: { id: 1300, name: "game 1300" },
      values: { 1: 0.000701, 3: 0.007 },
    });
    // One round of the scan, then the rows of the 1,299 games not read yet.
    const bodies = mock.calls.flatMap((c) => c.body.split("\n"));
    expect(bodies.filter((b) => /sort value desc; limit 500; offset \d+/.test(b))).toHaveLength(2);
    expect(bodies.some((b) => b.includes("game_id = (1201,1202,"))).toBe(true);
    // The round with the count and first ids, its rows and games, the other ids, their rows, 2 games.
    expect(mock.calls).toHaveLength(5);
    expect(mock.calls[4]?.body).toBe("fields name; where (game_status = 0) & (id = (1201,1202)); limit 2;");
  });

  test("stops after one round when the leaders outscore every unread row", async () => {
    const rows = rowsOf(
      PopularityType.IGDBPlaying,
      Array.from({ length: 1500 }, (_, i) => [i + 1, 1 / (i + 1)] as [number, number]),
    );
    const mock = api(rows);
    const top = await testClient(mock.fetch)
      .games.select("name")
      .weightedPopular({ [PopularityType.IGDBPlaying]: 1 });
    expect(top).toHaveLength(10);
    expect(top[0]).toEqual({ game: { id: 1, name: "game 1" }, score: 1, values: { 3: 1 } });
    expect(mock.calls.filter((c) => c.body.includes("sort value desc; limit 500"))).toHaveLength(1);
  });

  test("negative weights lower scores without being scanned; deleted games are skipped", async () => {
    const rows = [
      ...rowsOf(PopularityType.Steam24hrPeakPlayers, [
        [730, 0.19], // Counter-Strike 2
        [999, 0.1], // deleted game
        [570, 0.095],
      ]),
      ...rowsOf(PopularityType.SteamNegativeReviews, [
        [730, 0.06],
        [570, 0.006],
      ]),
    ];
    const mock = api(rows, { deleted: [999] });
    const top = await testClient(mock.fetch).games.weightedPopular({
      [PopularityType.Steam24hrPeakPlayers]: 1,
      [PopularityType.SteamNegativeReviews]: -1,
    });
    expect(top.map((t) => [t.game.id, t.score])).toEqual([
      [570, 0.4],
      [730, 0],
    ]);
    const bodies = mock.calls.map((c) => c.body).join("\n");
    expect(bodies).toContain("where popularity_type = 7; sort value desc; limit 1;");
    expect(bodies).not.toContain("popularity_type = 7; sort value desc; limit 500");
    // The top of the negative type goes with the first round.
    expect(mock.calls[0]?.body.split("\n")).toHaveLength(2);
  });

  test("the query's limit and offset page the ranking", async () => {
    const mock = api(small);
    const igdb = testClient(mock.fetch);
    const weights = { [PopularityType.IGDBWantToPlay]: 0.5, [PopularityType.IGDBPlaying]: 0.5 };
    const page = await igdb.games.limit(2).offset(1).weightedPopular(weights);
    expect(page.map((t) => [t.game.id, t.score])).toEqual([
      [10, 0.5],
      [40, 0.25],
    ]);
    expect((await igdb.games.offset(3).weightedPopular(weights)).map((t) => t.game.id)).toEqual([30]);
    const calls = mock.calls.length;
    expect(await igdb.games.limit(0).weightedPopular(weights)).toEqual([]);
    expect(mock.calls).toHaveLength(calls);
    await expect(igdb.games.sort("name").weightedPopular(weights).execute()).rejects.toThrow(
      /remove sort\(\)/,
    );
  });

  test("a where matching nothing stops after the first round", async () => {
    const mock = api(small, { filterAbove: 20_000 });
    const top = await testClient(mock.fetch)
      .games.where((g) => g.game_status.eq(0))
      .weightedPopular({ [PopularityType.IGDBWantToPlay]: 1 });
    expect(top).toEqual([]);
    expect(mock.calls).toHaveLength(1);
  });

  test("validates its input", async () => {
    const igdb = testClient(api(small).fetch);
    await expect(igdb.games.weightedPopular({ [PopularityType.IGDBPlaying]: -1 }).execute()).rejects.toThrow(
      /positive weight/,
    );
    await expect(
      igdb.games.weightedPopular({ [PopularityType.IGDBPlaying]: Number.NaN }).execute(),
    ).rejects.toThrow(QueryError);
    await expect(igdb.games.search("zelda").weightedPopular({ 3: 1 }).execute()).rejects.toThrow(/search/);
    // @ts-expect-error only on games
    expect(igdb.platforms.weightedPopular).toBeUndefined();
  });
});

describe("popularitySnapshot()", () => {
  const steam = rowsOf(PopularityType.Steam24hrPeakPlayers, [
    [1, 0.19],
    [2, 0],
    [3, 0.05],
    [4, 0],
    [5, 0.05],
  ]).map((r) => ({ ...r, calculated_at: 1791385517, external_popularity_source: 1 }));
  const twitch = rowsOf(PopularityType.Twitch24hrHoursWatched, [[301298, 0.09]]).map((r) => ({
    ...r,
    calculated_at: 1791493840,
    external_popularity_source: 14,
  }));

  test("yields one ranked array per type, equal values sharing a rank", async () => {
    const mock = api([...steam, ...twitch]);
    const igdb = testClient(mock.fetch);
    const pages = [];
    for await (const page of igdb.popularitySnapshot({ types: [5, 34, 99] })) pages.push(page);
    expect(pages).toHaveLength(2); // type 99 has no rows
    expect(pages[0]?.map((r) => [r.game_id, r.rank])).toEqual([
      [1, 1],
      [3, 2],
      [5, 2],
      [2, 4],
      [4, 4],
    ]);
    expect(pages[1]).toEqual([
      {
        game_id: 301298,
        popularity_type: 34,
        value: 0.09,
        rank: 1,
        calculated_at: 1791493840,
        external_popularity_source: 14,
      },
    ]);
    // Every row: pages in id order.
    expect(mock.calls.some((c) => c.body.includes("sort id asc; limit 500; offset 0;"))).toBe(true);
  });

  test("counts the types, then reads their pages in id order, two types at a time", async () => {
    const visits = rowsOf(
      PopularityType.IGDBVisits,
      Array.from({ length: 12_345 }, (_, i) => [i + 1, (12_345 - i) / 1e6] as [number, number]),
    );
    const mock = api([...visits, ...steam, ...twitch]);
    const pages = [];
    for await (const page of testClient(mock.fetch).popularitySnapshot({ types: [1, 5, 34] }))
      pages.push(page);
    expect(pages.map((page) => page.length)).toEqual([12_345, 5, 1]);
    expect(pages[0]?.[12_344]).toMatchObject({ game_id: 12_345, rank: 12_345 });
    const calls = mock.calls.map((c) => c.body);
    expect(calls[0]?.match(/popularity_primitives\/count/g)).toHaveLength(3);
    const lines = calls.flatMap((body) => body.split("\n"));
    expect(
      lines.filter((b) => b.includes("popularity_type = 1; sort id asc; limit 500; offset")),
    ).toHaveLength(25);
    expect(lines.some((b) => b.includes("id >"))).toBe(false);
    // Visits and Steam go out together; Twitch once Visits is read.
    const lastVisits = calls.reduce((last, b, i) => (b.includes("popularity_type = 1;") ? i : last), -1);
    expect(calls.findIndex((b) => b.includes("popularity_type = 5; sort id asc"))).toBeLessThanOrEqual(
      lastVisits,
    );
    expect(calls.findIndex((b) => b.includes("popularity_type = 34; sort id asc"))).toBeGreaterThan(
      lastVisits,
    );
    expect(mock.calls).toHaveLength(5);
  });

  test("reads the rows added since the count after the last id read", async () => {
    const visits = rowsOf(
      PopularityType.IGDBVisits,
      Array.from({ length: 700 }, (_, i) => [i + 1, (700 - i) / 1e6] as [number, number]),
    );
    const mock = api(visits, { staleCount: 200 });
    const pages = [];
    for await (const page of testClient(mock.fetch).popularitySnapshot({ types: [1] })) pages.push(page);
    expect(pages[0]).toHaveLength(700);
    expect(mock.calls.some((c) => c.body.includes(`id > ${100_499}`))).toBe(true);
  });

  test("limit reads only the most popular rows of each type, in value order", async () => {
    const many = rowsOf(
      PopularityType.IGDBVisits,
      Array.from({ length: 1200 }, (_, i) => [i + 1, (1200 - i) / 1e6] as [number, number]),
    );
    const mock = api(many);
    const pages = [];
    for await (const page of testClient(mock.fetch).popularitySnapshot({ types: 1, limit: 700 }))
      pages.push(page);
    expect(pages[0]).toHaveLength(700);
    expect(pages[0]?.[699]).toMatchObject({ game_id: 700, rank: 700, calculated_at: null });
    const bodies = mock.calls.map((c) => c.body).join("\n");
    expect(bodies).toContain("sort value desc; limit 500; offset 0;");
    expect(bodies).toContain("sort value desc; limit 200; offset 500;");
  });

  test("defaults to every PopularityType, skips incomplete and duplicate rows, validates limit", async () => {
    const mock = api([]);
    const igdb = testClient(mock.fetch);
    for await (const _ of igdb.popularitySnapshot()) throw new Error("no rows expected");
    const types = new Set(
      mock.calls.flatMap((c) => [...c.body.matchAll(/popularity_type = (\d+)/g)].map((m) => m[1])),
    );
    expect(types.size).toBe(Object.keys(PopularityType).length);
    expect(
      rankRows([
        { id: 1, game_id: 1, popularity_type: 1, value: 0.5 },
        { id: 2, game_id: 1, popularity_type: 1, value: 0.4 },
        { id: 3, popularity_type: 1, value: 0.3 },
        { id: 4, game_id: 2, popularity_type: 1 },
      ]).map((r) => [r.game_id, r.value]),
    ).toEqual([[1, 0.5]]);
    await expect(igdb.popularitySnapshot({ limit: 0 }).next()).rejects.toThrow(QueryError);
    await expect(igdb.popularitySnapshot({ limit: 1.5 }).next()).rejects.toThrow(QueryError);
  });
});
