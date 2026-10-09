import { describe, expect, test } from "bun:test";
import { and, NotFoundError, or } from "../../src";
import { type Call, mockFetch, testClient } from "./helpers";

/** Companies by lowercased name, as IGDB's `name ~ "..."` matches them. */
const COMPANIES: Record<string, number[]> = {
  "cd projekt red": [908],
  "square enix": [26],
  nintendo: [70, 4116],
};
/** Companies with their number of games, for suggestions. */
const ALL_NAMES: [string, number][] = [
  ["CD Projekt RED", 40],
  ["Ubisoft Annecy", 12],
  ["Square Enix", 900],
  ["Ubisoft Montreal", 393],
  ["Ubisoft Entertainment", 1351],
];

function companiesApi(call: Call): Response {
  const contains = /name ~ \*"(.*)"\*/.exec(call.body)?.[1];
  if (contains !== undefined) {
    const found = ALL_NAMES.filter(([name]) => name.toLowerCase().includes(contains.toLowerCase()));
    return Response.json(
      found.map(([name, games], i) => ({
        id: 1000 + i,
        name,
        published: Array.from({ length: games }, (_, g) => g),
      })),
    );
  }
  const name = /name ~ "(.*)"/.exec(call.body)?.[1] ?? "";
  return Response.json((COMPANIES[name.toLowerCase()] ?? []).map((id) => ({ id })));
}

function api() {
  return mockFetch((call) => {
    if (call.url.endsWith("/companies")) return companiesApi(call);
    if (call.url.endsWith("/games/count")) return Response.json({ count: 42 });
    return Response.json([{ id: 1942 }]);
  });
}
const gameCalls = (calls: Call[]) => calls.filter((c) => /\/games(\/count)?$/.test(c.url));

describe("company names in developedBy() and publishedBy()", () => {
  test("are looked up first, then the query filters on their ids", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const query = igdb.games.where((g) => g.developedBy("CD Projekt RED"));
    expect(await query.count()).toBe(42);
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["companies", "count"]);
    expect(mock.calls[0]?.body).toBe('fields id; where name ~ "CD Projekt RED"; limit 500;');
    expect(mock.calls[1]?.body).toBe(
      "where involved_companies.company = (908) & involved_companies.developer = true;",
    );
    // The name form, which IGDB also accepts, is what the query shows.
    expect(query.toApicalypse()).toBe(
      'where involved_companies.company.name ~ "CD Projekt RED" & involved_companies.developer = true;',
    );
  });

  test("several names become one id list, so the role stays on one company entry", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    await igdb.games.where((g) => g.publishedBy("Square Enix", "nintendo")).limit(5);
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual(["multiquery", "games"]);
    expect(mock.calls[1]?.body).toBe(
      "where involved_companies.company = (26,70,4116) & involved_companies.publisher = true; limit 5;",
    );
  });

  test("each filter gets its own ids, even when one name is in both", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    await igdb.games
      .where((g) => or(g.developedBy("Nintendo"), g.publishedBy("Nintendo", "Square Enix")))
      .where((g) => g.rating.gt(80));
    expect(gameCalls(mock.calls).map((c) => c.body)).toEqual([
      "where ((involved_companies.company = (70,4116) & involved_companies.developer = true) | " +
        "(involved_companies.company = (26,70,4116) & involved_companies.publisher = true)) & (rating > 80);",
    ]);
  });

  test("lookups are cached for a day and shared by first(), findById() and views", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const cdpr = igdb.games.where((g) => g.developedBy("CD Projekt RED"));
    await cdpr.first();
    await cdpr.findById(1942);
    await igdb.defineView("games", { select: ["name"] }).where((g) => g.developedBy("cd projekt red"));
    const lookups = mock.calls.filter((c) => c.url.endsWith("/companies"));
    // "cd projekt red" is another query body, so it has its own cache entry.
    expect(lookups.map((c) => c.body)).toEqual([
      'fields id; where name ~ "CD Projekt RED"; limit 500;',
      'fields id; where name ~ "cd projekt red"; limit 500;',
    ]);
    expect(gameCalls(mock.calls).every((c) => c.body.includes("involved_companies.company = (908)"))).toBe(
      true,
    );
  });

  test("an unknown name throws NotFoundError with the companies that contain it", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const error = await igdb.games
      .where((g) => g.developedBy("Ubisoft", "CD Projekt RED"))
      .execute()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).message).toBe(
      'No company named "Ubisoft". Close names: "Ubisoft Entertainment", "Ubisoft Montreal", "Ubisoft Annecy"',
    );
    // Those with the most games first.
    expect((error as NotFoundError).suggestions).toEqual([
      "Ubisoft Entertainment",
      "Ubisoft Montreal",
      "Ubisoft Annecy",
    ]);
    expect(gameCalls(mock.calls)).toHaveLength(0); // the games query is never sent

    const none = await igdb.games
      .where((g) => g.publishedBy("Nobody Games"))
      .execute()
      .catch((e: unknown) => e);
    expect((none as NotFoundError).message).toBe('No company named "Nobody Games"');
    expect((none as NotFoundError).suggestions).toEqual([]);
  });

  test("ids are sent as given, without a lookup", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    await igdb.games.where((g) => g.developedBy(908)).count();
    expect(mock.calls.map((c) => c.body)).toEqual([
      "where involved_companies.company = (908) & involved_companies.developer = true;",
    ]);
  });
});

describe("named() on relations", () => {
  const PLATFORMS = [
    { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC", alternative_name: "mswin" },
    { id: 7, name: "PlayStation", abbreviation: "PS1", alternative_name: "PSX, PSOne, PS" },
    { id: 130, name: "Nintendo Switch", abbreviation: "Switch", alternative_name: "NX" },
    { id: 167, name: "PlayStation 5", abbreviation: "PS5", alternative_name: "PS5" },
  ];
  const GENRES = [
    { id: 12, name: "Role-playing (RPG)" },
    { id: 11, name: "Real Time Strategy (RTS)" },
  ];
  const FRANCHISES: Record<string, number[]> = { "the witcher": [452] };

  function namesApi() {
    return mockFetch((call) => {
      if (call.url.endsWith("/platforms")) return Response.json(PLATFORMS);
      if (call.url.endsWith("/genres")) return Response.json(GENRES);
      if (call.url.endsWith("/franchises")) {
        const contains = /name ~ \*"(.*)"\*/.exec(call.body)?.[1];
        if (contains !== undefined)
          return Response.json([
            { id: 1, name: "Witcher Fan Games", games: [1] },
            { id: 452, name: "The Witcher", games: [1, 2, 3] },
          ]);
        const name = /name ~ "(.*)"/.exec(call.body)?.[1] ?? "";
        return Response.json((FRANCHISES[name.toLowerCase()] ?? []).map((id) => ({ id })));
      }
      if (call.url.endsWith("/companies")) return companiesApi(call);
      return Response.json([{ id: 1942 }]);
    });
  }

  test("a reference table is read once and matched by name, abbreviation, alternative name and parts", async () => {
    const mock = namesApi();
    const igdb = testClient(mock.fetch);
    await igdb.games.where((g) => g.platforms.named("ps5", "Nintendo Switch", "PSOne")).limit(1);
    await igdb.games.where((g) => and(g.platforms.named("pc"), g.genres.named("RPG", "real time strategy")));
    const tables = mock.calls.filter((c) => !/\/games$/.test(c.url));
    expect(tables.map((c) => [c.url.split("/").pop(), c.body])).toEqual([
      ["platforms", "fields id,name,abbreviation,alternative_name; sort id asc; limit 500;"],
      ["genres", "fields id,name; sort id asc; limit 500;"],
    ]);
    expect(gameCalls(mock.calls).map((c) => c.body)).toEqual([
      "where platforms = (7,130,167); limit 1;",
      "where platforms = (6) & genres = (11,12);",
    ]);
  });

  test("any other endpoint is a cached query per name; companies too, through any relation", async () => {
    const mock = namesApi();
    const igdb = testClient(mock.fetch);
    await igdb.games.where((g) => or(g.franchise.named("The Witcher"), g.franchises.named("the witcher")));
    await igdb.games.where((g) => g.involved_companies.company.named("Square Enix"));
    // The two franchise names go out together, in one multiquery.
    expect(mock.calls.map((c) => c.url.split("/").pop())).toEqual([
      "multiquery",
      "games",
      "companies",
      "games",
    ]);
    expect(mock.calls[0]?.body).toContain(
      'query franchises "q0" { fields id; where name ~ "The Witcher"; limit 500; };',
    );
    expect(mock.calls[0]?.body).toContain('fields id; where name ~ "the witcher"; limit 500;');
    expect(mock.calls[2]?.body).toBe('fields id; where name ~ "Square Enix"; limit 500;');
    expect(gameCalls(mock.calls).map((c) => c.body)).toEqual([
      "where franchise = (452) | franchises = (452);",
      "where involved_companies.company = (26);",
    ]);
  });

  test("a name that matches nothing throws with close names, before the games query", async () => {
    const mock = namesApi();
    const igdb = testClient(mock.fetch);
    const error = await igdb.games
      .where((g) => and(g.platforms.named("PlayStation 6", "Switch"), g.genres.named("Strategy")))
      .execute()
      .catch((e: unknown) => e);
    expect((error as NotFoundError).message).toBe(
      'No platform named "PlayStation 6"; No genre named "Strategy". Close names: "Real Time Strategy (RTS)"',
    );
    expect((error as NotFoundError).suggestions).toEqual(["Real Time Strategy (RTS)"]);
    const franchise = await igdb.games
      .where((g) => g.franchises.named("Witcher"))
      .execute()
      .catch((e: unknown) => e);
    // The franchises with the most games first.
    expect((franchise as NotFoundError).suggestions).toEqual(["The Witcher", "Witcher Fan Games"]);
    expect(gameCalls(mock.calls)).toHaveLength(0);
  });
});
