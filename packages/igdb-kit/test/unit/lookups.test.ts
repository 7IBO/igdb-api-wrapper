import { describe, expect, test } from "bun:test";
import { NotFoundError, or } from "../../src";
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
