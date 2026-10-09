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

function searchClient(rows: unknown[], total = rows.length) {
  const mock = mockFetch((call: Call) => {
    const offset = Number(/offset (\d+);/.exec(call.body)?.[1] ?? 0);
    const limit = Number(/limit (\d+);/.exec(call.body)?.[1] ?? 10);
    return Response.json(rows.slice(offset, offset + limit), { headers: { "x-count": String(total) } });
  });
  return { igdb: testClient(mock.fetch), calls: mock.calls };
}

describe("searchAll", () => {
  test("filters game hits by type and edition, and asks only for the requested kinds", async () => {
    const { igdb, calls } = searchClient([]);
    await igdb.searchAll("witcher", { kinds: ["game", "character"], select: { game: ["cover.image_id"] } });
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
      editions: true,
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
    await expect(igdb.searchAll("x", { limit: 501 })).rejects.toThrow(QueryError);
    await expect(igdb.searchAll("x", { limit: 0 })).rejects.toThrow(QueryError);
    await expect(igdb.searchAll("x", { kinds: [] })).rejects.toThrow(/kinds/);
    // @ts-expect-error companies are not in the search index
    await expect(igdb.searchAll("x", { kinds: ["company"] })).rejects.toThrow(/kinds/);
    await expect(igdb.searchAll("x", { gameTypes: [] })).rejects.toThrow(/gameTypes/);
    await expect(igdb.searchAll("x", { maxRows: 0 })).rejects.toThrow(/maxRows/);
    // @ts-expect-error unknown field
    await expect(igdb.searchAll("x", { select: { game: ["nope"] } })).rejects.toThrow(
      /Game has no field "nope"/,
    );
    expect(calls).toHaveLength(0);
  });
});
