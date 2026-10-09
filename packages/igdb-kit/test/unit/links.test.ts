import { describe, expect, test } from "bun:test";
import { defineSelection, type EndpointName, endpoints, gameLink, QueryError } from "../../src";
import { type Call, mockFetch, testClient } from "./helpers";

type Row = Record<string, unknown> & { id: number };

/**
 * A tiny IGDB: answers `fields`, `where` with `id = (..)`, `id > n` and `<link> = (..)`, `sort id asc`,
 * `limit`, and `/count`, over in-memory tables. Shapes follow the real API: release dates point to
 * one game, characters to several, time to beat by `game_id`.
 */
function fakeIgdb(tables: Record<string, Row[]>) {
  return mockFetch((call: Call) => {
    const path = call.url.split("/v4/")[1] ?? "";
    const [endpoint, count] = path.split("/");
    let rows = tables[endpoint as string] ?? [];
    const where = call.body.match(/where (.*?);/)?.[1] ?? "";
    for (const [, field, list] of where.matchAll(/(\w+) = \(([^)]*)\)/g)) {
      const wanted = new Set((list as string).split(",").map(Number));
      rows = rows.filter((row) => {
        const value = row[field as string];
        const values = Array.isArray(value) ? value : [value];
        return values.some((v) => wanted.has(typeof v === "object" ? (v as Row)?.id : (v as number)));
      });
    }
    const after = where.match(/id > (-?\d+)/)?.[1];
    if (after !== undefined) rows = rows.filter((row) => row.id > Number(after));
    if (count) return Response.json({ count: rows.length });
    if (call.body.includes("sort id asc")) rows = [...rows].sort((a, b) => a.id - b.id);
    rows = rows.slice(0, Number(call.body.match(/limit (\d+);/)?.[1] ?? 10));
    const fields = call.body
      .match(/fields (.*?);/)?.[1]
      ?.split(",")
      .map((f) => f.split(".")[0]);
    const project = (row: Row) =>
      fields && !fields.includes("*")
        ? Object.fromEntries(Object.entries(row).filter(([k]) => k === "id" || fields.includes(k)))
        : row;
    return Response.json(rows.map(project));
  });
}

const releaseDates: Row[] = [
  { id: 1, game: 10, date: 300, platform: 6 },
  { id: 2, game: 10, date: 100, platform: 48 },
  { id: 3, game: 20, date: 200, platform: 6 },
  { id: 4, game: 99, date: 50, platform: 6 },
  { id: 5, game: 10, platform: 167 }, // TBA: no date
];
const characters: Row[] = [
  { id: 1, name: "Geralt", games: [10, 20, 30] },
  { id: 2, name: "Ciri", games: [10] },
  { id: 3, name: "Nameless" }, // no games at all
];
const timeToBeats: Row[] = [{ id: 7, game_id: 10, normally: 254778 }];

describe("gameLink()", () => {
  test("reads the field pointing to games from the schema", () => {
    const linked = Object.fromEntries(
      (Object.keys(endpoints) as EndpointName[]).flatMap((e) => {
        const link = gameLink(e);
        return link ? [[e, link]] : [];
      }),
    );
    expect(linked).toEqual({
      alternative_names: "game",
      artworks: "game",
      characters: "games",
      collection_memberships: "game",
      collections: "games",
      covers: "game",
      events: "games",
      executables: "game",
      external_games: "game",
      franchises: "games",
      game_content_safety_ratings: "game",
      game_localizations: "game",
      game_time_to_beats: "game_id",
      game_version_feature_values: "game",
      game_versions: "game", // its main game; `games` lists the editions
      game_videos: "game",
      involved_companies: "game",
      language_supports: "game",
      logos: "game",
      multiplayer_modes: "game",
      popularity_primitives: "game_id",
      release_dates: "game",
      screenshots: "game",
      websites: "game",
    });
  });
});

describe("byGame()", () => {
  test("groups rows by game, with an empty list for games nothing points to", async () => {
    const mock = fakeIgdb({ release_dates: releaseDates });
    const igdb = testClient(mock.fetch);
    const byGame = await igdb.release_dates.select("date").byGame([10, 20, 30, 10]);
    expect([...byGame]).toEqual([
      [
        10,
        [
          { id: 1, date: 300 },
          { id: 2, date: 100 },
          { id: 5 }, // the link field is removed again when not selected
        ],
      ],
      [20, [{ id: 3, date: 200 }]],
      [30, []],
    ]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.body).toBe(
      "fields date,game; where (game = (10,20,30)) & (id > -1); sort id asc; limit 500;",
    );
  });

  test("keeps the link field when selected, and applies the query's where", async () => {
    const mock = fakeIgdb({ release_dates: releaseDates });
    const igdb = testClient(mock.fetch);
    const byGame = await igdb.release_dates
      .select("game", "platform")
      .where((r) => r.platform.in(6, 48))
      .byGame([10]);
    expect(byGame.get(10)).toEqual([
      { id: 1, game: 10, platform: 6 },
      { id: 2, game: 10, platform: 48 },
    ]);
    expect(mock.calls[0]?.body).toContain("where ((platform = (6,48)) & (game = (10))) & (id > -1);");
  });

  test("a row linked to several games is the same object under each", async () => {
    const igdb = testClient(fakeIgdb({ characters }).fetch);
    const byGame = await igdb.characters.select("name").byGame([10, 20]);
    expect(byGame.get(10)).toEqual([
      { id: 1, name: "Geralt" },
      { id: 2, name: "Ciri" },
    ]);
    expect(byGame.get(20)).toEqual([{ id: 1, name: "Geralt" }]);
    expect(byGame.get(20)?.[0] === byGame.get(10)?.[0]).toBe(true);
  });

  test("identical calls in flight share one request, and each gets its rows", async () => {
    const mock = fakeIgdb({ release_dates: releaseDates });
    const igdb = testClient(mock.fetch);
    const query = igdb.release_dates.select("date");
    const [a, b] = await Promise.all([query.byGame([10, 20]), query.byGame([10, 20])]);
    const expected: [number, { id: number; date?: number }[]][] = [
      [10, [{ id: 1, date: 300 }, { id: 2, date: 100 }, { id: 5 }]],
      [20, [{ id: 3, date: 200 }]],
    ];
    expect([...a]).toEqual(expected);
    expect([...b]).toEqual(expected);
    expect(mock.calls).toHaveLength(1);
  });

  test("handles expanded links and game_id keys", async () => {
    const expanded = characters.map((c) => ({
      ...c,
      games: (c.games as number[] | undefined)?.map((id) => ({ id, name: `game ${id}` })),
    }));
    const igdb = testClient(fakeIgdb({ characters: expanded, game_time_to_beats: timeToBeats }).fetch);
    const chars = await igdb.characters.select("games.name").byGame([30]);
    expect(chars.get(30)?.map((c) => c.id)).toEqual([1]);
    const ttb = await igdb.game_time_to_beats.select("normally").byGame([10, 11]);
    expect([...ttb]).toEqual([
      [10, [{ id: 7, normally: 254778 }]],
      [11, []], // no time to beat: the usual case
    ]);
  });

  test("sorts and limits each game's rows", async () => {
    const igdb = testClient(fakeIgdb({ release_dates: releaseDates }).fetch);
    const first = await igdb.release_dates.select("date").sort("date", "asc").limit(2).byGame([10]);
    expect(first.get(10)).toEqual([
      { id: 2, date: 100 },
      { id: 1, date: 300 },
    ]);
    const all = await igdb.release_dates.select("date").sort("date", "desc").byGame([10]);
    expect(all.get(10)?.map((r) => r.id)).toEqual([1, 2, 5]); // rows without the field last
  });

  test("reads past 500 rows of one game with an id cursor", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, game: 10 }));
    const mock = fakeIgdb({ screenshots: rows });
    const igdb = testClient(mock.fetch);
    const byGame = await igdb.screenshots.byGame([10]);
    expect(byGame.get(10)).toHaveLength(1200);
    expect(mock.calls.map((c) => c.body.match(/id > (-?\d+)/)?.[1])).toEqual(["-1", "500", "1000"]);
  });

  test("splits ids by the count when they have more rows than a page", async () => {
    // 100 games with 30 language rows each: 3000 rows.
    const rows = Array.from({ length: 3000 }, (_, i) => ({ id: i + 1, game: (i % 100) + 1 }));
    const mock = fakeIgdb({ language_supports: rows });
    const igdb = testClient(mock.fetch);
    const ids = Array.from({ length: 100 }, (_, i) => i + 1);
    const byGame = await igdb.language_supports.byGame(ids);
    expect([...byGame.values()].every((group) => group.length === 30)).toBe(true);
    expect(new Set([...byGame.values()].flat().map((r) => r.id)).size).toBe(3000);
    // First page, count, then 8 parts of 13 games (~390 rows each) read in parallel, in multiqueries.
    const blocks = mock.calls.map((c) => (c.url.endsWith("multiquery") ? c.body.split("\n").length : 1));
    expect(blocks).toEqual([1, 1, 8]);
  });

  test("sends ids 500 per query, together", async () => {
    const mock = fakeIgdb({ game_time_to_beats: timeToBeats });
    const igdb = testClient(mock.fetch);
    const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
    const byGame = await igdb.game_time_to_beats.byGame(ids);
    expect(byGame.size).toBe(1200);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.body.split("\n")).toHaveLength(3);
  });

  test("a page IGDB finds too heavy is split by its games, then read in smaller pages", async () => {
    // 4 games with 120 screenshots each; IGDB refuses pages above 100 rows.
    const rows = Array.from({ length: 480 }, (_, i) => ({ id: i + 1, game: (i % 4) + 1 }));
    const fake = fakeIgdb({ screenshots: rows });
    const mock = mockFetch((call) => {
      const limit = Number(call.body.match(/limit (\d+);/)?.[1] ?? 10);
      if (limit > 100) return Response.json([{ title: "Payload Too Large", status: 413 }], { status: 413 });
      return fake.fetch(call.url, { method: "POST", body: call.body });
    });
    const igdb = testClient(mock.fetch);
    const byGame = await igdb.screenshots.byGame([1, 2, 3, 4]);
    expect([...byGame.values()].map((group) => group.length)).toEqual([120, 120, 120, 120]);
    expect(new Set([...byGame.values()].flat().map((r) => r.id)).size).toBe(480);
    // 4 games, then 2 + 2, then 1 game at a time, with smaller pages until they pass.
    const games = (body: string) => body.match(/game = \(([\d,]+)\)/)?.[1]?.split(",").length;
    const pages = mock.calls.map((c) => [games(c.body), Number(c.body.match(/limit (\d+);/)?.[1])]);
    expect(pages.slice(0, 3)).toEqual([
      [4, 500],
      [2, 500],
      [2, 500],
    ]);
    expect(pages.filter(([, limit]) => (limit as number) <= 100).every(([count]) => count === 1)).toBe(true);
  });

  test("rejects what it cannot do", async () => {
    const igdb = testClient(fakeIgdb({}).fetch);
    expect(await igdb.characters.byGame([])).toEqual(new Map());
    await expect(igdb.characters.search("geralt").byGame([1])).rejects.toThrow(/search/);
    await expect(igdb.release_dates.offset(5).byGame([1])).rejects.toThrow(/offset/);
    await expect(igdb.release_dates.byGame([-1])).rejects.toThrow(QueryError);
    // @ts-expect-error genres do not point to games
    await expect(igdb.genres.byGame([1])).rejects.toThrow(/linked to games/);
  });
});

describe("defineView()", () => {
  const games: Row[] = [
    { id: 10, name: "The Witcher 3" },
    { id: 20, name: "The Witcher 2" },
  ];
  const tables = { games, release_dates: releaseDates, characters, game_time_to_beats: timeToBeats };

  function view(igdb: ReturnType<typeof testClient>) {
    return igdb.defineView("games", {
      select: ["name"],
      with: {
        timeToBeat: igdb.game_time_to_beats.select("normally"),
        characters: igdb.characters.select("name"),
      },
    });
  }

  test("findById sends the game and its links in one multiquery", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const game = await view(igdb).findById(10);
    expect(game).toEqual({
      id: 10,
      name: "The Witcher 3",
      timeToBeat: [{ id: 7, normally: 254778 }],
      characters: [
        { id: 1, name: "Geralt" },
        { id: 2, name: "Ciri" },
      ],
    });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url).toEndWith("/multiquery");
    expect(mock.calls[0]?.body.split("\n")).toHaveLength(3);
    expect(await view(igdb).findById(404)).toBeNull();
  });

  test("the same game loaded twice at once has its links both times", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const [a, b] = await Promise.all([view(igdb).findById(10), view(igdb).findById(10)]);
    expect(a?.characters).toHaveLength(2);
    expect(b).toEqual(a);
    expect(mock.calls).toHaveLength(1);
  });

  test("findByIds keeps the order and gives every game its links, empty or not", async () => {
    const igdb = testClient(fakeIgdb(tables).fetch);
    const rows = await view(igdb).findByIds([20, 404, 10]);
    expect(rows.map((r) => [r.id, r.timeToBeat.length, r.characters.length])).toEqual([
      [20, 0, 1],
      [10, 1, 2],
    ]);
  });

  test("a list runs the games first, then every link at once, even with autoBatch off", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch, { autoBatch: false });
    const rows = await view(igdb).where("id != 0").limit(2);
    expect(rows.map((r) => r.characters.length)).toEqual([2, 1]);
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["games", "multiquery"]);
    expect(mock.calls[0]?.body).toBe("fields name; where id != 0; limit 2;");
    expect((await view(igdb).first())?.id).toBe(10);
  });

  test("a search is sent alone before the links", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    await view(igdb).search("witcher").limit(2);
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["games", "multiquery"]);
    expect(mock.calls[0]?.body).toContain('search "witcher";');
  });

  test("rejects keys that hide game fields and queries not linked to games", () => {
    const igdb = testClient(fakeIgdb(tables).fetch);
    // @ts-expect-error name is a game field
    expect(() => igdb.defineView("games", { with: { name: igdb.characters } })).toThrow(/field of games/);
    expect(() => igdb.defineView("games", { with: { g: igdb.genres } })).toThrow(/does not point to games/);
    expect(() => igdb.defineView("games", { with: { c: igdb.characters.search("x") } })).toThrow(/search/);
    // @ts-expect-error views are on games
    expect(() => igdb.defineView("platforms", {})).toThrow(/on games/);
  });
});

describe("expand()", () => {
  const platforms: Row[] = [
    { id: 6, name: "PC" },
    { id: 48, name: "PlayStation 4" },
  ];
  const covers: Row[] = [{ id: 1, image_id: "co1" }];
  const rows: { id: number; platforms?: number[]; cover?: number }[] = [
    { id: 10, platforms: [6, 48, 999], cover: 1 },
    { id: 20, platforms: [6], cover: 2 }, // cover 2 and platform 999 no longer exist
    { id: 30 },
  ];

  test("loads a reference table whole once, then serves it from the cache", async () => {
    const mock = fakeIgdb({ platforms });
    const igdb = testClient(mock.fetch);
    const expanded = await igdb.expand(rows, "platforms", igdb.platforms.select("name"));
    expect(expanded).toEqual([
      { id: 10, platforms: [platforms[0], platforms[1]], cover: 1 },
      { id: 20, platforms: [platforms[0]], cover: 2 },
      { id: 30 },
    ] as never);
    expect(expanded[0]?.platforms?.[0]).toBe(expanded[1]?.platforms?.[0] as never); // one object per entity
    // The whole table, then the id it lacks (new since cached, or deleted).
    expect(mock.calls.map((c) => c.body)).toEqual([
      "fields name; sort id asc; limit 500;",
      "fields name; where id = (999); limit 1;",
    ]);
    await igdb.expand(rows.slice(1), "platforms", igdb.platforms.select("name"));
    expect(mock.calls).toHaveLength(2);
    expect(rows[0]?.platforms).toEqual([6, 48, 999]); // input untouched
  });

  test("fetches other endpoints by id, deduplicated, and drops missing ones", async () => {
    const mock = fakeIgdb({ covers, platforms });
    const igdb = testClient(mock.fetch);
    const expanded = await igdb.expand(rows, "cover", igdb.covers.select("image_id"));
    expect(expanded).toEqual([
      { id: 10, platforms: [6, 48, 999], cover: { id: 1, image_id: "co1" } },
      { id: 20, platforms: [6] },
      { id: 30 },
    ]);
    expect(mock.calls.map((c) => c.body)).toEqual(["fields image_id; where id = (1,2); limit 2;"]);
    // cache(false) on a reference table fetches by id too.
    await igdb.expand(rows, "platforms", igdb.platforms.select("name").cache(false));
    expect(mock.calls[1]?.body).toBe("fields name; where id = (6,48,999); limit 3;");
    expect(await igdb.expand(rows.slice(0, 0), "platforms", igdb.platforms)).toEqual([]);
    expect(mock.calls).toHaveLength(2);
  });
});

describe("defineSelection()", () => {
  test("checks and freezes the paths", () => {
    const card = defineSelection("games", "name", "cover.image_id", "name");
    expect(card).toEqual(["name", "cover.image_id"]);
    expect(Object.isFrozen(card)).toBe(true);
    // @ts-expect-error unknown field
    expect(() => defineSelection("games", "nom")).toThrow(QueryError);
    const igdb = testClient(fakeIgdb({}).fetch);
    expect(igdb.games.select(...card, "summary").toApicalypse()).toBe("fields name,cover.image_id,summary;");
  });
});
