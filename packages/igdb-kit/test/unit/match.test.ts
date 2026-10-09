import { describe, expect, test } from "bun:test";
import { NotFoundError, QueryError } from "../../src";
import { relationalFake as fakeIgdb, testClient } from "./helpers";

type Row = Record<string, unknown> & { id: number };

const MARCH_2016 = 1458777600;
const MAY_2016 = 1463097600;
const DECEMBER_1993 = 755481600;

const games: Row[] = [
  {
    id: 1,
    name: "Dark Souls III",
    game_type: 0,
    platforms: [48, 6],
    release_dates: [101, 102],
    total_rating_count: 2000,
  },
  { id: 2, name: "Dark Souls III: Deluxe Edition", game_type: 0, version_parent: 1, platforms: [48] },
  { id: 3, name: "Doom", game_type: 0, platforms: [6], release_dates: [103], total_rating_count: 1000 },
  { id: 4, name: "Doom", game_type: 0, platforms: [48, 6], release_dates: [104], total_rating_count: 1954 },
  { id: 5, name: "Doom", game_type: 5, platforms: [6] },
  { id: 6, name: "Pokémon Sword", game_type: 0, platforms: [130] },
  { id: 7, name: "Final Fantasy VII", game_type: 0 },
  { id: 8, name: "The Witcher 3: Wild Hunt", game_type: 0, total_rating_count: 3000 },
  { id: 9, name: "The Witcher 3: Wild Hunt - Game of the Year Edition", game_type: 3, version_parent: 8 },
  { id: 10, name: "NieR: Automata", game_type: 0 },
];
const tables = {
  games,
  alternative_names: [
    { id: 1, name: "Pokémon Épée", game: 6 },
    // A row of a deleted game: its game does not expand.
    { id: 2, name: "Doom", game: 999 },
  ],
  game_localizations: [{ id: 1, name: "ウィッチャー3 ワイルドハント", game: 8 }],
  release_dates: [
    { id: 101, date: MARCH_2016, platform: 48 },
    { id: 102, date: MARCH_2016, platform: 6 },
    { id: 103, date: DECEMBER_1993, platform: 6 },
    { id: 104, date: MAY_2016, platform: 48 },
  ],
  platforms: [
    { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" },
    { id: 48, name: "PlayStation 4", abbreviation: "PS4" },
    { id: 130, name: "Nintendo Switch", abbreviation: "Switch" },
  ],
};

function client() {
  const fake = fakeIgdb(tables);
  return { igdb: testClient(fake.fetch), calls: fake.calls };
}

const summary = (matches: { game: { id: number }; score: number; matched: string; title: string }[]) =>
  matches.map(({ game, score, matched, title }) => ({ id: game.id, score, matched, title }));

describe("games.match()", () => {
  test("finds a store title despite trademark signs and case, with the selected fields only", async () => {
    const { igdb, calls } = client();
    const matches = await igdb.games
      .select("name")
      .match({ name: "DARK SOULS™ III", platforms: ["PS4"], year: 2016 });
    expect(matches[0]).toEqual({
      game: { id: 1, name: "Dark Souls III" },
      score: 1,
      title: "Dark Souls III",
      matched: "name",
    });
    // The edition only resembles the title, and has no date: under minScore.
    expect(matches.map((m) => m.game.id)).toEqual([1]);
    // The search alone, then one multiquery: the equal names, alternative names, localized titles
    // and the platforms. The rows read hold the name: no request for the candidates.
    expect(calls.map((call) => call.url.split("/v4/")[1])).toEqual(["games", "multiquery"]);
    expect(calls[0]?.body).toContain('search "DARK SOULS III"');
    expect(calls[1]?.body.match(/query (\w+)/g)).toEqual([
      "query alternative_names",
      "query game_localizations",
      "query platforms",
      "query games",
    ]);
    // Other fields are read for the candidates.
    const [withSummary] = await igdb.games.select("name", "summary").match({ name: "Dark Souls III" });
    expect(withSummary?.game).toEqual({ id: 1, name: "Dark Souls III" });
    expect(calls.at(-1)?.body).toBe("fields name,summary; where id = (1,2); limit 2;");
    const all = await igdb.games.match({
      name: "DARK SOULS™ III",
      platforms: ["PS4"],
      year: 2016,
      minScore: 0,
    });
    expect(summary(all)[1]).toEqual({
      id: 2,
      score: 0.47,
      matched: "name",
      title: "Dark Souls III: Deluxe Edition",
    });
  });

  test("reads alternative and localized titles, sequel numerals and punctuation", async () => {
    const { igdb } = client();
    expect(summary(await igdb.games.match({ name: "Pokémon Épée" }))).toEqual([
      { id: 6, score: 0.97, matched: "alternative_name", title: "Pokémon Épée" },
    ]);
    expect(summary(await igdb.games.match({ name: "ウィッチャー3 ワイルドハント" }))).toEqual([
      { id: 8, score: 0.97, matched: "localized_name", title: "ウィッチャー3 ワイルドハント" },
    ]);
    expect(summary(await igdb.games.match({ name: "Final Fantasy 7" }))[0]).toEqual({
      id: 7,
      score: 1,
      matched: "name",
      title: "Final Fantasy VII",
    });
    // IGDB's search needs "NieR Automata": the title without punctuation is searched too.
    expect((await igdb.games.match({ name: "NieR:Automata" }))[0]).toMatchObject({
      game: { id: 10 },
      score: 1,
    });
  });

  test("ranks an edition named by the title first, then the game without the edition", async () => {
    const { igdb } = client();
    const matches = await igdb.games.match({ name: "The Witcher® 3: Wild Hunt - GOTY Edition" });
    expect(summary(matches).slice(0, 2)).toEqual([
      { id: 9, score: 1, matched: "name", title: "The Witcher 3: Wild Hunt - Game of the Year Edition" },
      { id: 8, score: 0.95, matched: "name", title: "The Witcher 3: Wild Hunt" },
    ]);
  });

  test("platforms and year tell games of the same name apart", async () => {
    const { igdb } = client();
    // Without them, equal scores: the most rated first, the mod last.
    expect(summary(await igdb.games.match({ name: "DOOM" }))).toEqual([
      { id: 4, score: 1, matched: "name", title: "Doom" },
      { id: 3, score: 1, matched: "name", title: "Doom" },
      { id: 5, score: 0.9, matched: "name", title: "Doom" },
    ]);
    // The 1993 game, on PC only, falls under minScore.
    expect(summary(await igdb.games.match({ name: "DOOM", platforms: [48], year: 2016 }))).toEqual([
      { id: 4, score: 1, matched: "name", title: "Doom" },
      { id: 5, score: 0.567, matched: "name", title: "Doom" },
    ]);
    // A year apart, or a platform IGDB has no game on.
    const near = await igdb.games.match({ name: "Doom", platforms: ["PS4"], year: 2017, minScore: 0 });
    // PS4 a year apart; on PC only, mod without dates; on PC only, 1993.
    expect(summary(near).map((m) => [m.id, m.score])).toEqual([
      [4, 0.9],
      [5, 0.567],
      [3, 0.42],
    ]);
  });

  test("the query's where and limit apply", async () => {
    const { igdb } = client();
    const mains = await igdb.games.where("game_type = 0").match({ name: "Doom" });
    expect(mains.map((m) => m.game.id)).toEqual([4, 3]);
    const first = await igdb.games.limit(1).match({ name: "Doom" });
    expect(first.map((m) => m.game.id)).toEqual([4]);
    expect(await igdb.games.limit(0).match({ name: "Doom" })).toEqual([]);
  });

  test("rejects bad input", async () => {
    const { igdb } = client();
    await expect(igdb.games.match({ name: " " }).execute()).rejects.toThrow(QueryError);
    await expect(igdb.games.match({ name: "Doom", year: 2016.5 }).execute()).rejects.toThrow(QueryError);
    await expect(igdb.games.match({ name: "Doom", minScore: 2 }).execute()).rejects.toThrow(QueryError);
    await expect(igdb.games.match({ name: "Doom", platforms: [4.5] }).execute()).rejects.toThrow(QueryError);
    await expect(igdb.games.sort("name").match({ name: "Doom" }).execute()).rejects.toThrow(
      "match() ranks games by how well they match",
    );
    await expect(igdb.games.match({ name: "Doom", platforms: ["Dreamcast 2"] }).execute()).rejects.toThrow(
      NotFoundError,
    );
  });
});
