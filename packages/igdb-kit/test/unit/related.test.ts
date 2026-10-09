import { describe, expect, test } from "bun:test";
import { QueryError } from "../../src";
import { type Call, mockFetch, testClient } from "./helpers";

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
function fakeIgdb(tables: Record<string, Row[]>) {
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

const games: Row[] = [
  { id: 1, name: "Main", game_type: 0, first_release_date: 300, bundles: [50] },
  {
    id: 2,
    name: "Main GOTY",
    game_type: 0,
    version_parent: 1,
    version_title: "GOTY",
    first_release_date: 400,
  },
  { id: 3, name: "DLC", game_type: 1, parent_game: 1, first_release_date: 350 },
  { id: 4, name: "Mod", game_type: 5, parent_game: 1 },
  { id: 5, name: "Expansion", game_type: 2, parent_game: 1, first_release_date: 320 },
  // An edition that also has the game as parent_game: listed once, as an edition.
  { id: 6, name: "Main Deluxe", game_type: 0, version_parent: 1, parent_game: 1, first_release_date: 500 },
  { id: 50, name: "Bundle", game_type: 3, first_release_date: 600 },
  { id: 60, name: "Prequel", game_type: 0, first_release_date: 100 },
  { id: 61, name: "Side story", game_type: 0, first_release_date: 200 },
  { id: 62, name: "Sub-series game", game_type: 0, first_release_date: 250 },
  { id: 63, name: "Spin-off series game", game_type: 0 },
  { id: 64, name: "Story arc game", game_type: 0, first_release_date: 260 },
];
const collections: Row[] = [
  { id: 10, name: "Series", games: [60, 1, 61] },
  { id: 11, name: "Sub-series", games: [62, 1] },
  { id: 12, name: "Spin-off series", games: [63] },
  { id: 13, name: "Story arc", games: [64] },
];
const memberships: Row[] = [
  { id: 1, game: 60, collection: 10, type: 1 },
  { id: 2, game: 1, collection: 10, type: 1 },
  { id: 3, game: 61, collection: 10, type: 2 },
  { id: 4, game: 62, collection: 11, type: 1 },
  { id: 5, game: 1, collection: 11, type: 2 },
  { id: 6, game: 63, collection: 12, type: 1 },
  { id: 7, game: 64, collection: 13, type: 1 },
];
const relations: Row[] = [
  { id: 1, parent_collection: 10, child_collection: 11, type: 1 },
  { id: 2, parent_collection: 10, child_collection: 12, type: 2 },
  { id: 3, parent_collection: 11, child_collection: 13, type: 34 },
];
const companies: Row[] = [
  { id: 100, name: "Group" },
  { id: 101, name: "Studio", parent: 100 },
  { id: 102, name: "Port house", parent: 101 },
  { id: 103, name: "Other" },
];
const flags = { developer: false, publisher: false, porting: false, supporting: false };
const involved: Row[] = [
  { id: 1, company: 100, game: 1, ...flags, developer: true, publisher: true },
  { id: 2, company: 100, game: 1, ...flags, developer: true }, // IGDB repeats some rows
  { id: 3, company: 101, game: 2, ...flags, publisher: true },
  { id: 4, company: 102, game: 3, ...flags, porting: true },
  { id: 5, company: 103, game: 4, ...flags, developer: true },
  { id: 6, company: 100, game: 60, ...flags, supporting: true },
];
const tables = {
  games,
  collections,
  collection_memberships: memberships,
  collection_relations: relations,
  companies,
  involved_companies: involved,
};

describe("findBy()", () => {
  test("groups rows by any relation, including those with no field back", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const editions = await igdb.games.select("name").findBy("version_parent", [1, 60]);
    expect([...editions]).toEqual([
      [
        1,
        [
          { id: 2, name: "Main GOTY" },
          { id: 6, name: "Main Deluxe" },
        ],
      ],
      [60, []],
    ]);
    expect(mock.calls[0]?.body).toBe(
      "fields name,version_parent; where (version_parent = (1,60)) & (id > -1); sort id asc; limit 500;",
    );
    const subsidiaries = await igdb.companies.select("name").findBy("parent", [100, 101]);
    expect(subsidiaries.get(100)).toEqual([{ id: 101, name: "Studio" }]);
    expect(subsidiaries.get(101)).toEqual([{ id: 102, name: "Port house" }]);
  });

  test("with one id, sends no link field to group by", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const children = await igdb.games.select("name").findBy("parent_game", [1]);
    expect(children.get(1)?.map((g) => g.name)).toEqual(["DLC", "Mod", "Expansion", "Main Deluxe"]);
    expect(mock.calls[0]?.body).toStartWith("fields name; where (parent_game = (1)) & (id > -1);");
  });

  test("rejects fields that are not links", async () => {
    const igdb = testClient(fakeIgdb(tables).fetch);
    // @ts-expect-error name is not a link
    await expect(igdb.games.findBy("name", [1]).execute()).rejects.toThrow(QueryError);
    // @ts-expect-error id is the row's own id
    await expect(igdb.games.findBy("id", [1]).execute()).rejects.toThrow(/relation or an \.\.\._id field/);
  });
});

describe("linkedBy()", () => {
  test("links a view to games by any field pointing to games", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const view = igdb.defineView("games", {
      select: ["name"],
      with: {
        editions: igdb.games.select("version_title").linkedBy("version_parent"),
        children: igdb.games.select("name").linkedBy("parent_game"),
      },
    });
    const game = await view.findById(1);
    expect(game?.editions.map((e) => e.version_title)).toEqual(["GOTY", undefined]);
    expect(game?.children).toHaveLength(4);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url).toEndWith("/multiquery");
  });

  test("rejects fields that do not point to games, and games queries without it in a view", () => {
    const igdb = testClient(fakeIgdb(tables).fetch);
    // @ts-expect-error platforms are not games
    expect(() => igdb.games.linkedBy("platforms")).toThrow(/points to games/);
    // @ts-expect-error parent points to companies
    expect(() => igdb.companies.linkedBy("parent")).toThrow(QueryError);
    expect(() => igdb.defineView("games", { with: { e: igdb.games.select("name") } })).toThrow(
      /does not point to games: name the field with linkedBy\(\)/,
    );
  });
});

describe("family()", () => {
  test("reads the game and every related game in one multiquery", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const family = await igdb.games.select("name").family(1);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url).toEndWith("/multiquery");
    expect(mock.calls[0]?.body.split("\n")).toHaveLength(6);
    expect(family).toEqual({
      game: { id: 1, name: "Main" },
      parent: null,
      editions: [
        { id: 2, name: "Main GOTY" },
        { id: 6, name: "Main Deluxe" },
      ],
      children: [
        { game: { id: 5, name: "Expansion" }, relation: "expansion" },
        { game: { id: 3, name: "DLC" }, relation: "dlc" },
        { game: { id: 4, name: "Mod" }, relation: "mod" },
      ],
      bundles: [{ id: 50, name: "Bundle" }],
      contents: [],
      series: [
        {
          collection: { id: 10, name: "Series" },
          games: [
            { game: { id: 60, name: "Prequel" }, spinoff: false },
            { game: { id: 61, name: "Side story" }, spinoff: true },
            { game: { id: 1, name: "Main" }, spinoff: false },
          ],
        },
        {
          collection: { id: 11, name: "Sub-series" },
          games: [
            { game: { id: 62, name: "Sub-series game" }, spinoff: false },
            { game: { id: 1, name: "Main" }, spinoff: true },
          ],
        },
      ],
    });
  });

  test("gives the parent, a bundle's contents, and keeps the fields it reads when selected", async () => {
    const igdb = testClient(fakeIgdb(tables).fetch);
    const edition = await igdb.games.select("game_type", "first_release_date").family(2);
    expect(edition?.game).toEqual({ id: 2, game_type: 0, first_release_date: 400 });
    expect(edition?.parent).toEqual({ id: 1, relation: "edition", title: "GOTY" });
    const dlc = await igdb.games.family(3);
    expect(dlc?.game).toEqual({ id: 3 });
    expect(dlc?.parent).toEqual({ id: 1, relation: "dlc", title: null });
    const bundle = await igdb.games.select("name").family(50);
    expect(bundle?.contents).toEqual([{ id: 1, name: "Main" }]);
  });

  test("is null for a missing game and rejects filters", async () => {
    const igdb = testClient(fakeIgdb(tables).fetch);
    expect(await igdb.games.family(404)).toBeNull();
    await expect(igdb.games.where("id = 1").family(1).execute()).rejects.toThrow(/fields only/);
    await expect(igdb.games.limit(5).family(1).execute()).rejects.toThrow(QueryError);
  });
});

describe("series()", () => {
  test("lists a series in release order, undated last, with its spin-offs flagged", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const series = await igdb.games.select("name").series(10);
    expect(series).toEqual([
      { game: { id: 60, name: "Prequel" }, collection: { id: 10, name: "Series" }, spinoff: false },
      { game: { id: 61, name: "Side story" }, collection: { id: 10, name: "Series" }, spinoff: true },
      { game: { id: 1, name: "Main" }, collection: { id: 10, name: "Series" }, spinoff: false },
    ]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.body).toBe(
      "fields type,collection.name,game.name,game.first_release_date; where (collection = (10)) & (id > -1); sort id asc; limit 500;",
    );
  });

  test("adds sub-series and story arcs at every depth, and spin-off series unless asked not to", async () => {
    const igdb = testClient(fakeIgdb(tables).fetch);
    const all = await igdb.games.select("name").series(10, { subseries: true });
    expect(all.map((entry) => [entry.game.id, entry.collection.id, entry.spinoff])).toEqual([
      [60, 10, false],
      [61, 10, true],
      [62, 11, false],
      [64, 13, false],
      [1, 10, false],
      [63, 12, true],
    ]);
    const main = await igdb.games.series(10, { subseries: true, spinoffs: false });
    expect(main.map((entry) => entry.game)).toEqual([{ id: 60 }, { id: 62 }, { id: 64 }, { id: 1 }]);
  });
});

describe("catalog()", () => {
  test("merges a company's rows per game, with its roles", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const catalog = await igdb.games.select("name").catalog(100);
    expect(catalog).toEqual([
      { game: { id: 60, name: "Prequel" }, roles: ["supporting"], companies: [100] },
      { game: { id: 1, name: "Main" }, roles: ["developer", "publisher"], companies: [100] },
    ]);
    expect(mock.calls[0]?.body).toBe(
      "fields developer,publisher,porting,supporting,game.name,game.first_release_date; " +
        "where ((developer = true | publisher = true | porting = true | supporting = true) & (company = (100))) & (id > -1); " +
        "sort id asc; limit 500;",
    );
  });

  test("keeps the roles asked for, and adds subsidiaries at every depth", async () => {
    const mock = fakeIgdb(tables);
    const igdb = testClient(mock.fetch);
    const developed = await igdb.games.catalog(100, { roles: ["developer"] });
    expect(developed).toEqual([{ game: { id: 1 }, roles: ["developer"], companies: [100] }]);
    expect(mock.calls[0]?.body).toContain("where ((developer = true) & (company = (100))) & (id > -1);");

    const group = await igdb.games.select("name").catalog(100, { includeSubsidiaries: true });
    expect(group.map((entry) => [entry.game.name, entry.roles, entry.companies])).toEqual([
      ["Prequel", ["supporting"], [100]],
      ["Main", ["developer", "publisher"], [100]],
      ["DLC", ["porting"], [102]],
      ["Main GOTY", ["publisher"], [101]],
    ]);
    await expect(igdb.games.catalog(100, { roles: [] }).execute()).rejects.toThrow(/needs roles/);
  });
});
