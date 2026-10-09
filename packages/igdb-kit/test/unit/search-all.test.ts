import { describe, expect, test } from "bun:test";
import { GameType, QueryError } from "../../src";
import { type Call, mockFetch, testClient } from "./helpers";

// Rows as the search endpoint returns them for "witcher" (trimmed): the search `name` is IGDB's
// normalized index text, `alternative_name` is "" when the row comes from the main name, rows of
// people have no entity, and a deleted collection leaves no field once expanded.
const witcherRows = [
  {
    id: 33393353,
    name: "The Witcher 3 Wild Hunt Remastered",
    alternative_name: "",
    game: { id: 415005, name: "The Witcher 3: Wild Hunt Remastered" },
  },
  { id: 13073995, name: "The Witcher 4", alternative_name: "", game: { id: 324505, name: "The Witcher IV" } },
  {
    id: 100200,
    name: "The Witcher 3 Wild Hunt",
    alternative_name: "Wiedźmin 3 Dziki Gon TW3",
    game: { id: 1942, name: "The Witcher 3: Wild Hunt", total_rating_count: 5513 },
  },
  {
    id: 103186,
    name: "The Witcher",
    alternative_name: "",
    game: { id: 1940, name: "The Witcher", total_rating_count: 842 },
  },
  { id: 1300775, name: "The Witcher", collection: { id: 62, name: "The Witcher" } },
  { id: 4048217, name: "Gabe Witcher" }, // a person: no entity the API exposes
  { id: 31163841, name: "Witcher fan series" }, // its collection was deleted
  {
    id: 1768738,
    name: "Geralt of Rivia",
    alternative_name: "Geralt Gwynbleidd Butcher of Blaviken White Wolf Witcher",
    character: { id: 1453, name: "Geralt of Rivia" },
  },
  { id: 9628012, name: "Great Witcher", alternative_name: "", game: { id: 99, name: "Great Witcher" } },
];

function searchClient(
  rows: unknown[],
  total = rows.length,
  titles: { alternative_names?: unknown[]; game_localizations?: unknown[] } = {},
) {
  const mock = mockFetch((call: Call) => {
    if (call.url.endsWith("/alternative_names")) return Response.json(titles.alternative_names ?? []);
    if (call.url.endsWith("/game_localizations")) return Response.json(titles.game_localizations ?? []);
    const offset = Number(/offset (\d+);/.exec(call.body)?.[1] ?? 0);
    const limit = Number(/limit (\d+);/.exec(call.body)?.[1] ?? 10);
    return Response.json(rows.slice(offset, offset + limit), { headers: { "x-count": String(total) } });
  });
  return { igdb: testClient(mock.fetch), calls: mock.calls };
}

describe("searchAll", () => {
  test("filters game hits by type and edition, and asks only for the requested kinds", async () => {
    const { igdb, calls } = searchClient([]);
    await igdb.searchAll("witcher", {
      kinds: ["game", "character"],
      select: { game: ["cover.image_id"] },
      alternativeTitles: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toEndWith("/search");
    expect(calls[0]?.body).toBe(
      "fields name,alternative_name,game.name,game.cover.image_id,character.name,game.total_rating_count; " +
        'search "witcher"; where (game != null & game.game_type = (0,2,4,8,9,10,11) & game.version_parent = null) | ' +
        "character != null; limit 500;",
    );
    await igdb.searchAll("witcher", {
      kinds: ["game"],
      gameTypes: "all",
      includeEditions: true,
      order: "igdb",
      limit: 3,
    });
    expect(calls[1]?.body).toBe(
      'fields name,alternative_name,game.name; search "witcher"; where game != null; limit 3;',
    );
    await igdb.searchAll("witcher", { kinds: ["game"], gameTypes: [GameType.Mod], order: "igdb" });
    expect(calls[2]?.body).toContain(
      "where (game != null & game.game_type = (5) & game.version_parent = null);",
    );
    // One game type id, and the deprecated `editions`.
    await igdb.searchAll("witcher", {
      kinds: ["game"],
      gameTypes: GameType.Mod,
      editions: true,
      order: "igdb",
    });
    expect(calls[3]?.body).toContain("where (game != null & game.game_type = (5));");
    await expect(igdb.searchAll("witcher", { gameTypes: [] }).execute()).rejects.toThrow(QueryError);
  });

  test("ranks by name match, then ratings, then shorter names, and drops rows without an entity", async () => {
    const { igdb } = searchClient(witcherRows);
    const hits = await igdb.searchAll("witcher", { limit: 20 });
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual([
      "game:1942", // contains the words, 5513 ratings
      "game:1940", // 842 ratings
      "collection:62", // no ratings: shorter names first
      "game:99",
      "game:324505",
      "game:415005",
      "character:1453", // only in the alternative names
    ]);
    const geralt = hits.find((h) => h.kind === "character");
    expect(geralt).toEqual({
      kind: "character",
      id: 1453,
      name: "Geralt of Rivia",
      alternative_name: "Geralt Gwynbleidd Butcher of Blaviken White Wolf Witcher",
      matched: "alternative_name",
      character: { id: 1453, name: "Geralt of Rivia" },
    });
    // The rating used for ranking is not left in results that did not select it.
    expect(hits[0]).toEqual({
      kind: "game",
      id: 1942,
      name: "The Witcher 3: Wild Hunt",
      alternative_name: "Wiedźmin 3 Dziki Gon TW3",
      matched: "name",
      game: { id: 1942, name: "The Witcher 3: Wild Hunt" },
    });
    expect(hits.find((h) => h.id === 1940)).not.toHaveProperty("alternative_name"); // "" means none
    expect((await igdb.searchAll("witcher", { limit: 2 })).map((h) => h.id)).toEqual([1942, 1940]);
  });

  test("identical searches at once share one request and rank alike", async () => {
    const { igdb, calls } = searchClient(witcherRows);
    const [a, b] = await Promise.all([igdb.searchAll("witcher"), igdb.searchAll("witcher")]);
    expect(a.map((h) => h.id).slice(0, 2)).toEqual([1942, 1940]);
    expect(b).toEqual(a);
    // The search, then the alternative titles: 6 hits match by name, fewer than the limit.
    expect(calls.map((call) => call.url.split("/").pop())).toEqual(["search", "multiquery"]);
  });

  test("finds games by their alternative and localized titles", async () => {
    const witcher = { id: 1942, name: "The Witcher 3: Wild Hunt", total_rating_count: 5514 };
    const { igdb, calls } = searchClient([], 0, {
      alternative_names: [
        {
          id: 8058,
          name: "Wiedźmin 3: Dziki Gon - Serca z kamienia",
          game: { id: 12503, name: "The Witcher 3: Wild Hunt - Hearts of Stone", total_rating_count: 560 },
        },
        { id: 2495, name: "Wiedźmin 3: Dziki Gon", game: witcher },
        { id: 7, name: "Wiedźmin 3 fan remake" }, // its game was deleted
      ],
      game_localizations: [{ id: 181, name: "Wiedźmin 3", game: witcher }],
    });
    const hits = await igdb.searchAll("Wiedźmin 3", { select: { game: ["cover.image_id"] } });
    expect(hits).toEqual([
      {
        kind: "game",
        id: 1942,
        name: "The Witcher 3: Wild Hunt",
        alternative_name: "Wiedźmin 3",
        matched: "alternative_name",
        game: { id: 1942, name: "The Witcher 3: Wild Hunt" },
      },
      {
        kind: "game",
        id: 12503,
        name: "The Witcher 3: Wild Hunt - Hearts of Stone",
        alternative_name: "Wiedźmin 3: Dziki Gon - Serca z kamienia",
        matched: "alternative_name",
        game: { id: 12503, name: "The Witcher 3: Wild Hunt - Hearts of Stone" },
      },
    ]);
    // One multiquery after the search, which found nothing; the same filters and fields.
    const block =
      "{ fields name,game.name,game.cover.image_id,game.total_rating_count; " +
      'where (name ~ *"Wiedźmin 3"*) & game != null & game.game_type = (0,2,4,8,9,10,11) & ' +
      "game.version_parent = null; limit 100; };";
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toContain(`query alternative_names "q0" ${block}`);
    expect(calls[1]?.body).toContain(`query game_localizations "q1" ${block}`);
  });

  test("titles rank after every name match; a hit found by IGDB's alternative names takes a better one", async () => {
    const rows = [
      {
        id: 1,
        name: "The Witcher 3 Wild Hunt",
        alternative_name: "Wiedźmin 3 Dziki Gon TW3",
        game: { id: 1942, name: "The Witcher 3: Wild Hunt", total_rating_count: 5514 },
      },
      { id: 2, name: "Wiedzmin 3 Remake", alternative_name: "", game: { id: 5, name: "Wiedźmin 3 Remake" } },
    ];
    const { igdb } = searchClient(rows, 2, {
      alternative_names: [
        { id: 3, name: "Wiedźmin 3: Dziki Gon", game: { id: 1942, name: "The Witcher 3: Wild Hunt" } },
        { id: 4, name: "Wiedźmin 3", game: { id: 5, name: "Wiedźmin 3 Remake" } },
        // An exact title of an obscure game comes after the name matches, then by match and ratings.
        { id: 5, name: "Wiedźmin 3", game: { id: 6, name: "Witcher fan game" } },
        { id: 6, name: " Wielki Wiedźmin 3", game: { id: 7, name: "Great Witcher" } },
      ],
    });
    const hits = await igdb.searchAll("Wiedźmin 3", { kinds: ["game"] });
    expect(hits.map((h) => [h.id, h.matched, h.alternative_name ?? null])).toEqual([
      [5, "name", null],
      [6, "alternative_name", "Wiedźmin 3"],
      [1942, "alternative_name", "Wiedźmin 3: Dziki Gon"],
      [7, "alternative_name", "Wielki Wiedźmin 3"],
    ]);
  });

  test("alternativeTitles: auto, alongside the search for another script, always or never", async () => {
    const { igdb, calls } = searchClient(witcherRows);
    const urls = () => calls.splice(0).map((call) => call.url.split("/").pop());
    // Enough hits match by name: no titles.
    await igdb.searchAll("witcher", { limit: 3 });
    expect(urls()).toEqual(["search"]);
    // Another script: sent with the search, whatever it finds; the NFKC form too.
    await igdb.searchAll("ウィッチャー３", { limit: 3 });
    const sent = calls.map((call) => call.body).join(" ");
    expect(urls().sort()).toEqual(["multiquery", "search"]);
    expect(sent).toContain('where (name ~ *"ウィッチャー３"* | name ~ *"ウィッチャー3"*) & game != null');
    await igdb.searchAll("witcher", { limit: 3, alternativeTitles: true });
    expect(urls().sort()).toEqual(["multiquery", "search"]);
    await igdb.searchAll("Wiedźmin", { alternativeTitles: false });
    await igdb.searchAll("Wiedźmin", { order: "igdb" });
    await igdb.searchAll("Wiedźmin", { kinds: ["character"] });
    expect(urls()).toEqual(["search", "search", "search"]);
    // @ts-expect-error not an option value
    await expect(igdb.searchAll("x", { alternativeTitles: "yes" }).execute()).rejects.toThrow(
      /alternativeTitles/,
    );
  });

  test("an exact name comes first, and the search index name counts (VII is indexed as 7)", async () => {
    const { igdb } = searchClient([
      {
        id: 1,
        name: "Crisis Core Final Fantasy 7",
        alternative_name: "",
        game: { id: 10, name: "Crisis Core: Final Fantasy VII", total_rating_count: 176 },
      },
      { id: 2, name: "Final Fantasy 7", alternative_name: "", game: { id: 11, name: "Final Fantasy VII" } },
      { id: 3, name: "Final Fantasy 7 Remake", game: { id: 12, name: "Final Fantasy VII Remake" } },
    ]);
    const hits = await igdb.searchAll("Final Fantasy 7");
    expect(hits.map((h) => h.id)).toEqual([11, 12, 10]);
    expect(hits.every((h) => h.matched === "name")).toBe(true);
  });

  test("keeps the rating when selected, and accents or punctuation do not matter", async () => {
    const { igdb } = searchClient([
      { id: 1, name: "Pokemon Red", game: { id: 5, name: "Pokémon Red", total_rating_count: 604 } },
    ]);
    const [hit] = await igdb.searchAll("pokemon", { select: { game: ["total_rating_count"] } });
    expect(hit?.kind === "game" && hit.game).toEqual({ id: 5, name: "Pokémon Red", total_rating_count: 604 });
    expect(hit?.matched).toBe("name");
  });

  test("reads every match up to maxRows, 500 per request, in parallel after the first", async () => {
    const rows = Array.from({ length: 1048 }, (_, i) => ({
      id: 5000 - i,
      name: `Sonic ${i}`,
      game: { id: i + 1, name: `Sonic ${i}`, total_rating_count: i === 1047 ? 638 : 0 },
    }));
    const { igdb, calls } = searchClient(rows);
    const [best] = await igdb.searchAll("sonic", { kinds: ["game"] });
    expect(calls.map((c) => /offset \d+/.exec(c.body)?.[0] ?? "first")).toEqual([
      "first",
      "offset 500",
      "offset 1000",
    ]);
    expect(best?.id).toBe(1048); // the oldest row, last page, most rated
    await igdb.searchAll("sonic", { kinds: ["game"], maxRows: 600 });
    expect(calls).toHaveLength(5);
  });

  test("validates its options; an empty term sends nothing", async () => {
    const { igdb, calls } = searchClient([]);
    expect(await igdb.searchAll("  ")).toEqual([]);
    expect(calls).toHaveLength(0);
    await expect(igdb.searchAll("x", { limit: 501 }).execute()).rejects.toThrow(QueryError);
    await expect(igdb.searchAll("x", { limit: 0 }).execute()).rejects.toThrow(QueryError);
    await expect(igdb.searchAll("x", { kinds: [] }).execute()).rejects.toThrow(/kinds/);
    // @ts-expect-error companies are not in the search index
    await expect(igdb.searchAll("x", { kinds: ["company"] }).execute()).rejects.toThrow(/kinds/);
    await expect(igdb.searchAll("x", { gameTypes: [] }).execute()).rejects.toThrow(/gameTypes/);
    await expect(igdb.searchAll("x", { maxRows: 0 }).execute()).rejects.toThrow(/maxRows/);
    // @ts-expect-error unknown field
    await expect(igdb.searchAll("x", { select: { game: ["nope"] } }).execute()).rejects.toThrow(
      /Game has no field "nope"/,
    );
    expect(calls).toHaveLength(0);
  });
});
