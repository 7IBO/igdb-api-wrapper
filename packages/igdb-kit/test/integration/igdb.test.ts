// Runs against the real IGDB API. Skipped unless TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set.
// Uses about 90 requests. The webhook test registers webhooks on example.com and removes them.
import { describe, expect, test } from "bun:test";
import {
  AgeRatingCategory,
  AgeRatingOrganization,
  and,
  artworkType,
  createIGDB,
  DateFormat,
  defineSelection,
  type EndpointName,
  ExternalGameSource,
  endpoints,
  type GameLinkedQuery,
  GameType,
  gameLink,
  Language,
  MAIN_GAME_TYPES,
  NotFoundError,
  or,
  Platform,
  PopularityType,
  QueryError,
  Region,
  ReleaseDateRegion,
  ReleaseDateStatus,
  Theme,
  TierError,
  toDate,
} from "../../src";
import {
  ageRating,
  alternativeTitles,
  companies,
  eventTime,
  formatReleaseDate,
  languages,
  localizedCover,
  localizedName,
  parentGame,
  releaseDate,
  storeLinks,
  supportsLanguage,
  timeToBeat,
} from "../../src/game";
import { igdbProxy } from "../../src/proxy";

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;

// The describe body runs even when skipped, so only build the client when credentials exist.
const igdb = clientId && clientSecret ? createIGDB({ clientId, clientSecret }) : (undefined as never);

/** A client of its own (own cache), counting the IGDB responses other than 429. */
function countingClient() {
  const counter = { requests: 0 };
  const client = createIGDB({
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await fetch(input, init);
      if (String(input).includes("api.igdb.com") && response.status !== 429) counter.requests++;
      return response;
    }) as typeof fetch,
  });
  return {
    igdb: client,
    get requests() {
      return counter.requests;
    },
  };
}

describe.skipIf(!clientId || !clientSecret)("real IGDB API", () => {
  test("select with expansions returns the inferred shape", async () => {
    const game = await igdb.games.select("name", "cover.image_id", "platforms.name", "genres").findById(1942);
    expect(game?.name).toBe("The Witcher 3: Wild Hunt");
    expect(typeof game?.cover?.image_id).toBe("string");
    expect(game?.platforms?.every((p) => typeof p.id === "number" && typeof p.name === "string")).toBe(true);
    expect(game?.genres?.every((g) => typeof g === "number")).toBe(true);
  });

  test("typed where, sort and limit", async () => {
    const games = await igdb.games
      .select("name", "rating")
      .where((g) => g.rating.gte(90).and(g.rating_count.gte(100)))
      .sort("rating", "desc")
      .limit(5);
    expect(games).toHaveLength(5);
    expect(games.every((g) => (g.rating ?? 0) >= 90)).toBe(true);
  });

  test("count and withCount agree", async () => {
    const query = igdb.games.where((g) => g.rating.gte(95));
    const [count, page] = await Promise.all([query.count(), query.limit(1).withCount()]);
    expect(count).toBeGreaterThan(0);
    expect(page.total).toBe(count);
  });

  test("search", async () => {
    const games = await igdb.games.select("name").search("zelda").limit(5);
    expect(games.length).toBeGreaterThan(0);
  });

  test("findByIds keeps the requested order", async () => {
    const games = await igdb.games.select("name").findByIds([1020, 1942, 7346]);
    expect(games.map((g) => g.id)).toEqual([1020, 1942, 7346]);
  });

  test("iterate walks a whole small endpoint", async () => {
    const ids: number[] = [];
    for await (const genre of igdb.genres.select("name").iterate({ pageSize: 10 })) ids.push(genre.id);
    expect(ids.length).toBeGreaterThan(15);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  test("typed errors", async () => {
    await expect(igdb.raw("games", "fields nope;")).rejects.toBeInstanceOf(QueryError);
    await expect(igdb.content_safety_ratings.limit(1).execute()).rejects.toBeInstanceOf(TierError);
  });

  test("batch() sends typed queries in one multiquery", async () => {
    const { top, total, ps5 } = await igdb.batch({
      top: igdb.games
        .select("name")
        .where((g) => g.rating_count.gt(500))
        .sort("rating", "desc")
        .limit(3),
      total: igdb.games.count(),
      ps5: igdb.platforms.select("name").findById(167),
    });
    expect(top).toHaveLength(3);
    expect(total).toBeGreaterThan(100_000);
    expect(ps5?.name).toBe("PlayStation 5");
  });

  test("batch() runs tasks with queries, and their first requests share one multiquery", async () => {
    const counted = countingClient();
    const { games, dates, ps5 } = await counted.igdb.batch({
      games: counted.igdb.games.select("name").findByIds([1020, 1942]),
      dates: counted.igdb.release_dates.select("date", "platform").findByGames([1942]),
      ps5: counted.igdb.platforms.select("name").findById(167),
    });
    expect(games.map((g) => g.id)).toEqual([1020, 1942]);
    expect(games[1]?.name).toBe("The Witcher 3: Wild Hunt");
    expect(dates.get(1942)?.length).toBeGreaterThan(3);
    expect(ps5?.name).toBe("PlayStation 5");
    expect(counted.requests).toBe(1);
  });

  test("an invalid query in a batch only fails itself", async () => {
    const results = await Promise.allSettled([
      igdb.games.findById(1942).execute(),
      igdb.games.where("nope = 1").limit(1).execute(),
      igdb.platforms.findById(6).execute(),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(QueryError);
  });

  test("reference constants match the API and filter as documented", async () => {
    const types = await igdb.game_types.select("type").limit(500);
    expect(Object.fromEntries(types.map((t) => [t.id, t.type]))).toMatchObject({
      [GameType.MainGame]: "Main Game",
      [GameType.Remake]: "Remake",
    });
    const games = await igdb.games
      .select("name", "game_type", "version_parent", "platforms", "themes")
      .where((g) =>
        and(
          g.game_type.in(GameType.MainGame, GameType.Remake),
          g.version_parent.isNull(),
          g.platforms.any(Platform.PlayStation5),
          g.themes.none(Theme.Erotic),
        ),
      )
      .limit(20);
    expect(games).toHaveLength(20);
    for (const g of games) {
      expect([GameType.MainGame, GameType.Remake]).toContain(g.game_type as 0 | 8);
      expect(g.version_parent).toBeUndefined();
      expect(g.platforms).toContain(Platform.PlayStation5);
    }
  });

  test("a Date filters a timestamp field in seconds", async () => {
    const now = new Date();
    const upcoming = await igdb.release_dates
      .select("date", "game.name")
      .where((r) => r.date.gte(now))
      .sort("date", "asc")
      .limit(5);
    expect(upcoming).toHaveLength(5);
    for (const r of upcoming)
      expect(toDate(r.date ?? 0).getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
  });

  test("popular() returns games by PopScore, filtered by the query and paged by its limit and offset", async () => {
    const main = igdb.games.select("name", "game_type").where((g) => g.game_type.eq(GameType.MainGame));
    const top = await main.limit(10).popular(PopularityType.IGDBPlaying);
    expect(top).toHaveLength(10);
    expect(top.every((t) => t.game.game_type === GameType.MainGame && typeof t.game.name === "string")).toBe(
      true,
    );
    const values = top.map((t) => t.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const second = await main.limit(5).offset(5).popular(PopularityType.IGDBPlaying);
    expect(second.map((t) => t.game.id)).toEqual(top.slice(5).map((t) => t.game.id));
  });

  test("weightedPopular() mixes types scaled to 0..1, with null for a missing row", async () => {
    const top = await igdb.games
      .select("name")
      .where((g) => g.game_type.eq(GameType.MainGame))
      .limit(20)
      .weightedPopular({ [PopularityType.IGDBWantToPlay]: 0.5, [PopularityType.Steam24hrPeakPlayers]: 0.5 });
    expect(top).toHaveLength(20);
    const scores = top.map((t) => t.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.every((s) => s > 0 && s <= 1)).toBe(true);
    for (const { values } of top) {
      expect(Object.keys(values).sort()).toEqual(["2", "5"]);
      expect(Object.values(values).every((v) => v === null || v >= 0)).toBe(true);
    }
    // Many popular games are not on Steam: no row, which is not a measured 0.
    expect(top.some((t) => t.values[PopularityType.Steam24hrPeakPlayers] === null)).toBe(true);
  });

  test("popular() reads the rows of the few games a where matches: the exact top", async () => {
    const counting = countingClient();
    // Games released only on Switch 2: about 120, rare among the most visited.
    const only = (client: typeof igdb) =>
      client.games.where((g) => g.platforms.exactly(Platform.NintendoSwitch2));
    const top = await only(counting.igdb).limit(20).popular(PopularityType.IGDBVisits);
    expect(top).toHaveLength(20);
    expect(counting.requests).toBeLessThanOrEqual(5);
    // The same values from every row of those games.
    const ids: number[] = [];
    for await (const game of only(igdb).iterate()) ids.push(game.id);
    const chunks = Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) =>
      ids.slice(i * 500, i * 500 + 500),
    );
    const rows = await Promise.all(
      chunks.map((chunk) =>
        igdb.popularity_primitives
          .select("value")
          .where(`popularity_type = ${PopularityType.IGDBVisits} & game_id = (${chunk.join(",")})`)
          .limit(500),
      ),
    );
    const values = rows.flat().map((r) => r.value ?? 0);
    expect(top.map((t) => t.value)).toEqual(values.sort((a, b) => b - a).slice(0, 20));
  });

  test("popularitySnapshot() without limit reads every row of a type", async () => {
    const type = PopularityType.SteamMostWishlistedUpcoming;
    const total = await igdb.popularity_primitives.where((p) => p.popularity_type.eq(type)).count();
    const pages = [];
    for await (const rows of igdb.popularitySnapshot({ types: type })) pages.push(rows);
    expect(pages).toHaveLength(1);
    expect(new Set(pages[0]?.map((r) => r.game_id)).size).toBe(total);
    expect(pages[0]?.[0]?.rank).toBe(1);
  });

  test("artworkType() converts artwork_type as IGDB does, where image_type is missing", async () => {
    const [missing, both] = await Promise.all([
      igdb.artworks
        .select("image_type", "artwork_type")
        .where((a) => a.image_type.isNull())
        .limit(50),
      igdb.artworks
        .select("image_type", "artwork_type")
        .where((a) => and(a.image_type.notNull(), a.artwork_type.notNull()))
        .sort("id", "desc")
        .limit(500),
    ]);
    // IGDB still fills artwork_type where image_type is missing.
    expect(missing).toHaveLength(50);
    expect(missing.every((a) => artworkType(a) !== null)).toBe(true);
    // Where both are filled, the conversion gives IGDB's own image_type.
    expect(both).toHaveLength(500);
    for (const a of both)
      expect(artworkType({ image_type: undefined, artwork_type: a.artwork_type })).toBe(a.image_type ?? null);
  });

  test("popularitySnapshot() returns ranked rows with their calculation time; IGDB keeps no history", async () => {
    const types = [PopularityType.IGDBPlaying, PopularityType.Steam24hrPeakPlayers];
    const pages = [];
    for await (const rows of igdb.popularitySnapshot({ types, limit: 10 })) pages.push(rows);
    expect(pages.map((rows) => rows[0]?.popularity_type)).toEqual(types);
    expect(pages.map((rows) => rows[0]?.external_popularity_source)).toEqual([121, 1]);
    for (const rows of pages) {
      expect(rows.map((r) => r.rank)[0]).toBe(1);
      // Each type is recomputed in one batch, at most a few days ago.
      const at = new Set(rows.map((r) => r.calculated_at));
      expect(at.size).toBe(1);
      expect(Date.now() / 1000 - ([...at][0] ?? 0)).toBeLessThan(14 * 86_400);
    }
    const rows = await igdb.popularity_primitives
      .select("popularity_type")
      .where((p) => p.game_id.eq(1942))
      .limit(50);
    expect(rows.length).toBe(new Set(rows.map((r) => r.popularity_type)).size);
  });

  test("releases() in a past window: exact days and months, one entry per game", async () => {
    const calendar = await igdb.games.select("name").releases({ from: "1998-11-01", to: "1998-12-01" });
    expect(calendar.length).toBeGreaterThan(100);
    expect(new Set(calendar.map((e) => e.game.id)).size).toBe(calendar.length);
    const start = Date.UTC(1998, 10, 1);
    const end = Date.UTC(1998, 11, 1);
    for (const { release, releases } of calendar) {
      expect(["day", "month"]).toContain(release.precision);
      for (const r of releases) {
        expect(r.start?.getTime()).toBeGreaterThanOrEqual(start);
        expect(r.end?.getTime()).toBeLessThanOrEqual(end);
      }
    }
    expect(calendar.some((e) => e.release.precision === "month" && e.release.human === "Nov 1998")).toBe(
      true,
    );
    expect(calendar.some((e) => e.releases.length > 1)).toBe(true);
  });

  test("releases() in a future quarter: quarter labels, statuses and regions", async () => {
    const calendar = await igdb.games.releases({
      from: "2026-10-01",
      to: "2027-01-01",
      regions: [ReleaseDateRegion.Japan],
      precision: ["day", "quarter"],
    });
    expect(calendar.length).toBeGreaterThan(0);
    const releases = calendar.flatMap((e) => e.releases);
    expect(releases.every((r) => r.region === ReleaseDateRegion.Japan || r.region === 8)).toBe(true);
    expect(releases.some((r) => r.region === ReleaseDateRegion.Worldwide)).toBe(true);
    expect(releases.every((r) => r.status !== ReleaseDateStatus.Cancelled)).toBe(true);
    expect(releases.some((r) => r.status === null)).toBe(true);
    const quarter = releases.find((r) => r.precision === "quarter");
    expect(quarter?.human).toBe("Q4 2026");
    expect(quarter?.start?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  test("releases() with TBD dates only", async () => {
    const calendar = await igdb.games.releases({
      from: "2026-10-01",
      to: "2026-10-02",
      precision: ["tbd"],
      platforms: [Platform.PlayStation5],
      statuses: [ReleaseDateStatus.FullRelease],
    });
    expect(calendar.length).toBeGreaterThan(0);
    for (const { release } of calendar) {
      expect(release).toMatchObject({ precision: "tbd", start: null, end: null, platform: 167, status: 6 });
    }
  });

  test("findByExternalIds() finds games by Steam app id", async () => {
    const games = await igdb.games
      .select("name")
      .findByExternalIds(ExternalGameSource.Steam, ["292030", 570, "not-a-steam-id"]);
    expect(games.get("292030")?.name).toBe("The Witcher 3: Wild Hunt");
    expect(games.get("570")?.id).toBe(2963);
    expect(games.has("not-a-steam-id")).toBe(false);
  });

  test("sync reads every entity once, in id order", async () => {
    const seen: number[] = [];
    for await (const page of igdb.platforms.select("name").sync()) seen.push(...page.map((p) => p.id));
    expect(seen.length).toBe(await igdb.platforms.count());
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  test("sync reads matches spread over millions of ids in full pages", async () => {
    const counting = countingClient();
    // About 8,500 rows between ids 900,000 and 6,200,000, most of them near the end.
    const sellers = (client: typeof igdb) =>
      client.popularity_primitives
        .select("game_id")
        .where((p) => p.popularity_type.eq(PopularityType.SteamGlobalTopSellers));
    const seen: number[] = [];
    for await (const page of sellers(counting.igdb).sync()) seen.push(...page.map((p) => p.id));
    // The first page with the count, then the other pages in two multiqueries.
    expect(counting.requests).toBeLessThanOrEqual(4);
    expect(seen.every((id, i) => i === 0 || id > (seen[i - 1] as number))).toBe(true);
    expect(seen.length).toBe(await sellers(igdb).count());
  });

  test("webhooks: register, list, re-register and delete", async () => {
    const url = `https://example.com/igdb-kit-ci/${crypto.randomUUID()}`;
    const hooks = await igdb.webhooks.ensure({ url, secret: "ci-secret", endpoints: ["platforms"] });
    try {
      expect(hooks.map((h) => h.operation).sort()).toEqual(["create", "delete", "update"]);
      expect(hooks.every((h) => h.active && h.url.startsWith(url))).toBe(true);
      const again = await igdb.webhooks.register("platforms", {
        url: hooks[0]?.url as string,
        secret: "ci-secret",
        operation: hooks[0]?.operation as "create",
      });
      expect(again.id).toBe(hooks[0]?.id as number);
      const listed = await igdb.webhooks.list();
      expect(hooks.every((h) => listed.some((l) => l.id === h.id))).toBe(true);
      expect((await igdb.webhooks.get(hooks[1]?.id as number))?.url).toBe(hooks[1]?.url as string);
    } finally {
      await Promise.all(hooks.map((h) => igdb.webhooks.delete(h.id)));
    }
    const after = await igdb.webhooks.list();
    expect(after.some((l) => hooks.some((h) => h.id === l.id))).toBe(false);
  });

  test("a browser client queries through igdbProxy", async () => {
    const handler = igdbProxy({ igdb, endpoints: ["games", "platforms"], maxLimit: 20 });
    const browser = createIGDB({
      proxyUrl: "/api/igdb",
      fetch: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(new Request(new URL(String(input), "https://app.example"), init))) as typeof fetch,
    });
    const [witcher, ps5] = await Promise.all([
      browser.games.select("name").findById(1942),
      browser.platforms.select("name").findById(Platform.PlayStation5),
    ]);
    expect(witcher?.name).toBe("The Witcher 3: Wild Hunt");
    expect(ps5?.name).toBe("PlayStation 5");
    const { total } = await browser.games
      .select("name")
      .where((g) => g.game_type.eq(GameType.MainGame))
      .withCount();
    expect(total).toBeGreaterThan(100_000);
    expect(
      await browser.genres
        .select("name")
        .execute()
        .catch((e) => e),
    ).toBeInstanceOf(QueryError);
    expect(
      await browser.games
        .select("name")
        .limit(21)
        .execute()
        .catch((e) => e),
    ).toBeInstanceOf(QueryError);
  });

  test("IGDB accepts every filter operator the builder emits", async () => {
    const results = await igdb.batch({
      ops: igdb.games
        .select("name")
        .where((g) =>
          and(
            g.name.eq("Tetris"),
            g.name.ne("Doom"),
            g.rating.gt(1),
            g.rating.gte(1),
            g.rating.lt(100),
            g.rating.lte(100),
            g.id.in(1, 2, 3, 1942),
            g.id.notIn(4),
            g.name.notNull(),
            g.storyline.isNull(),
          ),
        ),
      arrays: igdb.games
        .select("name")
        .where((g) =>
          and(
            g.platforms.any(6, 48),
            g.platforms.all(6),
            g.platforms.none(130),
            g.themes.exactly(1),
            g.genres.notNull(),
          ),
        ),
      text: igdb.games
        .select("name")
        .where((g) =>
          or(
            g.name.startsWith("Witcher"),
            g.name.endsWith("Hunt", { caseSensitive: true }),
            g.name.contains("zelda"),
          ),
        ),
      nested: igdb.games.select("name").where((g) => g.release_dates.date.gte(new Date("2020-01-01"))),
    });
    expect(Object.values(results).every(Array.isArray)).toBe(true);
    expect(results.text.length).toBeGreaterThan(0);
  });

  test("new reference constants match the API", async () => {
    const { statuses, regions, ratings } = await igdb.batch({
      statuses: igdb.release_date_statuses.select("name").limit(500),
      regions: igdb.regions.select("identifier").limit(500),
      ratings: igdb.age_rating_categories.select("rating", "organization").limit(500),
    });
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.name]))).toMatchObject({
      [ReleaseDateStatus.Cancelled]: "Cancelled",
      [ReleaseDateStatus.FullRelease]: "Full Release",
      [ReleaseDateStatus.AdvancedAccess]: "Advanced Access",
    });
    expect(regions.find((r) => r.id === Region.Japan)?.identifier).toBe("ja-JP");
    const pegi18 = ratings.find((r) => r.id === AgeRatingCategory.PEGI_18);
    expect(pegi18).toMatchObject({ rating: "18", organization: AgeRatingOrganization.PEGI });
    expect(ratings.find((r) => r.id === AgeRatingCategory.USK_18)?.organization).toBe(
      AgeRatingOrganization.USK,
    );
  });

  test("exclude() drops top-level and nested fields, alone and in a multiquery", async () => {
    const [alone, batched] = await Promise.all([
      igdb.games.select("*", "cover.*").exclude("summary", "storyline", "cover.url").findById(1942),
      igdb.batch({
        witcher: igdb.games
          .select("name", "summary", "cover.*")
          .exclude("summary", "cover.url")
          .findById(1942),
        count: igdb.games.count(),
      }),
    ]);
    for (const game of [alone, batched.witcher]) {
      expect(game?.name).toBe("The Witcher 3: Wild Hunt");
      expect(game).not.toHaveProperty("summary");
      expect(typeof game?.cover?.image_id).toBe("string");
      expect(game?.cover).not.toHaveProperty("url");
    }
    expect(alone?.platforms?.length).toBeGreaterThan(0);
  });

  test("company filters by name match the same games as by id, and stay on one company entry", async () => {
    const [byId, byName, byLowerName, twoIds, twoNames] = await Promise.all([
      igdb.games.where((g) => g.developedBy(908)).count(),
      igdb.games.where((g) => g.developedBy("CD Projekt RED")).count(),
      igdb.games.where((g) => g.developedBy("cd projekt red")).count(),
      igdb.games.where((g) => g.developedBy(908, 26)).count(),
      igdb.games.where((g) => g.developedBy("CD Projekt RED", "Square Enix")).count(),
    ]);
    expect(byId).toBeGreaterThan(30);
    expect(byName).toBe(byId);
    expect(byLowerName).toBe(byId);
    expect(twoNames).toBe(twoIds);
    // A name is the whole name: "CD Projekt" is not "CD Projekt RED".
    expect(await igdb.games.where((g) => g.developedBy("CD Projekt")).count()).toBeLessThan(byId);
    // Names are sent as ids: a big publisher takes about a second, not the 24 s of a name filter.
    const start = Date.now();
    expect(await igdb.games.where((g) => g.publishedBy("Electronic Arts")).count()).toBeGreaterThan(1000);
    expect(Date.now() - start).toBeLessThan(8000);
    const unknown = await igdb.games
      .where((g) => g.developedBy("Ubisoft"))
      .count()
      .execute()
      .catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(NotFoundError);
    expect((unknown as NotFoundError).suggestions.slice(0, 2)).toEqual([
      "Ubisoft Entertainment",
      "Ubisoft Montreal",
    ]);
  }, 15_000); // a name costs one more request the first time: its lookup

  test("game filters match one involved company and one release date for all their conditions", async () => {
    const ids = (q: typeof igdb.games) =>
      q
        .limit(500)
        .execute()
        .then((games) => games.map((g) => g.id));
    const witcher = igdb.games.where((g) => g.id.in(1942, 214992));
    const [
      byCdpr,
      byWb,
      publishedByWb,
      switchBefore2020,
      switchSince2021,
      cancelledOnly,
      withCancelled,
      cancelledListed,
      fullOrNone,
      platforms,
    ] = await Promise.all([
      ids(witcher.where((g) => g.developedBy(908))),
      ids(witcher.where((g) => g.developedBy(50))), // WB Games only published it
      ids(witcher.where((g) => g.publishedBy(50))),
      ids(witcher.where((g) => g.releasedIn({ platforms: Platform.NintendoSwitch, to: "2020-01-01" }))),
      ids(witcher.where((g) => g.releasedIn({ platforms: Platform.NintendoSwitch, from: "2021-01-01" }))),
      // 214992: every release date is Cancelled, yet its platforms still list Xbox Series X|S.
      ids(witcher.where((g) => g.releasedIn({ platforms: Platform.XboxSeriesXS }))),
      // Deprecated names, still accepted.
      ids(witcher.where((g) => g.releasedIn({ platform: Platform.XboxSeriesXS, includeCancelled: true }))),
      ids(
        witcher.where((g) =>
          g.releasedIn({ platforms: Platform.XboxSeriesXS, statuses: [ReleaseDateStatus.Cancelled] }),
        ),
      ),
      ids(
        witcher.where((g) =>
          g.releasedIn({ platforms: Platform.XboxSeriesXS, statuses: [ReleaseDateStatus.FullRelease, null] }),
        ),
      ),
      ids(witcher.where((g) => g.platforms.any(Platform.XboxSeriesXS))),
    ]);
    expect(byCdpr).toEqual([1942]);
    expect(byWb).toEqual([]);
    expect(publishedByWb).toEqual([1942]);
    expect(switchBefore2020).toEqual([]); // the PS4 release is before 2020, the Switch one is not
    expect(switchSince2021).toEqual([1942]);
    expect(cancelledOnly).toEqual([1942]);
    expect(withCancelled.sort()).toEqual([1942, 214992]);
    expect(cancelledListed).toEqual([214992]);
    expect(fullOrNone).toEqual([1942]);
    expect(platforms.sort()).toEqual([1942, 214992]);
  });

  test("searchAll() returns typed hits of several kinds, ranked, without mods", async () => {
    const witcher = await igdb.searchAll("witcher", {
      select: { game: ["game_type", "version_parent"] },
      limit: 30,
    });
    expect(witcher[0]).toMatchObject({
      kind: "game",
      id: 1942,
      name: "The Witcher 3: Wild Hunt",
      matched: "name",
    });
    for (const hit of witcher) {
      expect((hit as unknown as Record<string, { id: number }>)[hit.kind]?.id).toBe(hit.id);
      if (hit.kind !== "game") continue;
      expect(MAIN_GAME_TYPES).toContain(hit.game.game_type as number);
      expect(hit.game.version_parent).toBeUndefined();
    }
    expect(witcher.some((h) => h.kind === "collection")).toBe(true);
    const [geralt] = await igdb.searchAll("gwynbleidd", { kinds: ["character"] });
    expect(geralt).toMatchObject({
      kind: "character",
      id: 1453,
      name: "Geralt of Rivia",
      matched: "alternative_name",
    });
    const platforms = await igdb.searchAll("playstation", { kinds: ["platform"], limit: 20 });
    expect(platforms.map((h) => h.id)).toContain(Platform.PlayStation5);
  });

  test("the search endpoint searches several entity types", async () => {
    const hits = await igdb.search.select("name", "game", "character", "company").search("witcher").limit(20);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => typeof h.game === "number")).toBe(true);
  });
  test("game helpers read a real game page", async () => {
    const { witcher, hades, erdtree, ttb } = await igdb.batch({
      witcher: igdb.games
        .select(
          "name",
          "first_release_date",
          "release_dates.*",
          "involved_companies.company.name",
          "involved_companies.developer",
          "involved_companies.publisher",
          "involved_companies.porting",
          "involved_companies.supporting",
          "websites.url",
          "websites.trusted",
          "external_games.uid",
          "external_games.url",
          "external_games.external_game_source",
          "external_games.platform",
          "external_games.countries",
          "external_games.game_release_format",
          "age_ratings.organization",
          "age_ratings.rating_category",
          "age_ratings.rating_content_descriptions.description",
          "cover.image_id",
          "game_localizations.name",
          "game_localizations.region",
          "game_localizations.cover.image_id",
          "alternative_names.name",
          "alternative_names.comment",
          "language_supports.language.locale",
          "language_supports.language_support_type",
        )
        .findById(1942),
      // Early access in 2018, 1.0 in 2020.
      hades: igdb.games.select("first_release_date", "release_dates.*").findById(113112),
      erdtree: igdb.games.select("game_type", "parent_game.name", "version_parent").findById(240009),
      ttb: igdb.game_time_to_beats
        .select("hastily", "normally", "completely", "count")
        .where((t) => t.game_id.eq(1942))
        .first(),
    });
    if (!witcher || !hades || !erdtree) throw new Error("game not found");

    expect(releaseDate(witcher)?.start?.getTime()).toBe((witcher.first_release_date ?? 0) * 1000);
    expect(releaseDate(hades)).toMatchObject({ status: ReleaseDateStatus.FullRelease, year: 2020 });
    expect(releaseDate(hades)?.start?.getTime()).toBe((hades.first_release_date ?? 0) * 1000);
    expect(releaseDate(hades, { statuses: [ReleaseDateStatus.EarlyAccess] })?.year).toBe(2018);
    // Hades came to the Switch in Japan on its own date.
    expect(releaseDate(hades, { locale: "ja-JP", platform: Platform.NintendoSwitch })).toMatchObject({
      region: ReleaseDateRegion.Japan,
      match: "exact",
    });

    expect(companies(witcher).developers.map((c) => c.name)).toContain("CD Projekt RED");
    expect(companies(witcher).publishers.length).toBeGreaterThan(1);
    const links = storeLinks(witcher);
    expect(links.find((l) => l.store === "steam")?.url).toContain("/app/292030");
    expect(new Set(links.map((l) => `${l.store} ${l.url}`)).size).toBe(links.length);
    expect(ageRating(witcher, AgeRatingOrganization.PEGI)).toMatchObject({ label: "18", minimumAge: 18 });
    expect(localizedName(witcher, "ja-JP")?.source).toBe("localization");
    expect(localizedName(witcher, "pl-PL")).toMatchObject({ source: "alternative_name", language: "pl" });
    const witcherRelease = releaseDate(witcher);
    if (witcherRelease)
      expect(formatReleaseDate(witcherRelease, { locale: "en-US" })).toBe(witcherRelease.human as string);
    expect(supportsLanguage(witcher, "fr-FR")).toMatchObject({ language: Language.French, audio: true });
    expect(ageRating(witcher, { locale: "ja-JP" })?.organization).toBe(AgeRatingOrganization.CERO);
    expect(localizedCover(witcher, "en-US")).toMatchObject({
      source: "cover",
      image_id: witcher.cover?.image_id,
    });
    expect(alternativeTitles(witcher).find((t) => t.language === "zh-Hans")?.name).toMatch(/\p{Script=Han}/u);
    expect(languages(witcher).find((l) => l.language.locale === "en-US")?.audio).toBe(true);
    expect(parentGame(erdtree)).toMatchObject({
      relation: "expansion",
      game: { id: 119133, name: "Elden Ring" },
    });
    expect(timeToBeat(ttb)?.seconds).toBeGreaterThan(36_000);
  });

  test("game helpers know every reference row they map", async () => {
    const { statuses, formats, categories, regions } = await igdb.batch({
      statuses: igdb.release_date_statuses.select("name").limit(500),
      formats: igdb.date_formats.select("format").limit(500),
      categories: igdb.age_rating_categories.select("rating", "organization").limit(500),
      regions: igdb.regions.select("identifier").limit(500),
    });
    for (const status of statuses) {
      const row = { id: 1, date: 0, date_format: 0, release_region: 8, platform: 6, status: status.id };
      expect(releaseDate({ release_dates: [row] })?.status).toBe(status.id);
      // Every status has a name, and so a rank: none is "other".
      expect(releaseDate({ release_dates: [row] }, { statuses: ["other"] })).toBeNull();
    }
    expect(formats.map((f) => f.id).sort()).toEqual(Object.values(DateFormat).sort());
    for (const category of categories) {
      const rating = { id: 1, organization: category.organization ?? 0, rating_category: category.id };
      expect(ageRating({ age_ratings: [rating] }, rating.organization)?.label).toBe(
        category.rating as string,
      );
    }
    for (const region of regions) {
      const cover = { id: 1, image_id: "y" };
      const game = { name: "x", cover, game_localizations: [{ id: 1, name: "y", region: region.id, cover }] };
      const locale = region.identifier === "EU" ? "fr-FR" : (region.identifier ?? "");
      expect(localizedName(game, locale)?.source).toBe("localization");
      expect(localizedCover(game, locale)?.source).toBe("localization");
    }
  });

  test("eventTime() knows the time zone of every recent event", async () => {
    const events = await igdb.events.select("start_time", "time_zone").sort("id", "desc").limit(500);
    expect(events.length).toBeGreaterThan(100);
    for (const event of events)
      if (event.time_zone) expect(eventTime(event, { locale: "en" }).timeZone).not.toBeNull();
  });

  test("findByGames() accepts the game link of every endpoint that has one", async () => {
    const linked = (Object.keys(endpoints) as EndpointName[]).filter((e) => gameLink(e) !== undefined);
    expect(linked.length).toBe(24);
    const maps = await Promise.all(
      linked.map((e) => (igdb[e] as unknown as GameLinkedQuery<"characters">).findByGames([1942])),
    );
    const rows = Object.fromEntries(linked.map((e, i) => [e, maps[i]?.get(1942)?.length]));
    expect(rows.release_dates).toBeGreaterThan(0);
    expect(rows.game_time_to_beats).toBe(1);
    expect(rows.popularity_primitives).toBeGreaterThan(5); // one row per PopScore type
    expect(rows.characters).toBeGreaterThan(10);
    expect(rows.game_versions).toBe(0);
  });

  test("findByGames() groups rows, reads past 500 rows and lists shared rows under each game", async () => {
    const ttb = await igdb.game_time_to_beats.select("normally").findByGames([1942, 999_999_999]);
    expect(ttb.get(1942)?.[0]?.normally).toBeGreaterThan(200_000); // seconds, about 70 h
    expect(ttb.get(999_999_999)).toEqual([]);
    // Games 109 and 9630 have the most characters in IGDB (362 and 273): more than one page.
    const chars = await igdb.characters.select("name").findByGames([109, 9630, 1942]);
    expect(chars.get(109)?.length).toBeGreaterThan(300);
    expect(chars.get(9630)?.length).toBeGreaterThan(200);
    expect(Object.keys(chars.get(1942)?.[0] ?? {}).sort()).toEqual(["id", "name"]);
    // Characters of the Mario franchise: about 950 games, some characters in several of them.
    const mario = await igdb.franchises.select("games").findByIdOrThrow(845);
    const byGame = await igdb.characters.select("name").findByGames(mario.games ?? []);
    expect(byGame.size).toBe(mario.games?.length ?? -1);
    const counts = new Map<number, number>();
    for (const rows of byGame.values()) for (const c of rows) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
  });

  test("a view loads a game and its links in one request", async () => {
    const counted = countingClient();
    const card = defineSelection("games", "name", "cover.image_id");
    const page = counted.igdb.defineView("games", {
      select: [...card, "platforms.name"],
      with: {
        timeToBeat: counted.igdb.game_time_to_beats.select("normally"),
        characters: counted.igdb.characters.select("name"),
        events: counted.igdb.events.select("name"),
        popularity: counted.igdb.popularity_primitives.select("popularity_type", "value"),
      },
    });
    const witcher = await page.findById(1942);
    expect(counted.requests).toBe(1);
    expect(witcher?.name).toBe("The Witcher 3: Wild Hunt");
    expect(witcher?.timeToBeat).toHaveLength(1);
    expect(witcher?.characters.length).toBeGreaterThan(10);
    expect(witcher?.events.length).toBeGreaterThan(0);
    const found = await page.search("witcher 3").limit(3);
    expect(counted.requests).toBe(3); // the search alone, then the links
    expect(found.every((g) => Array.isArray(g.characters))).toBe(true);
  });

  test("expand() caches reference tables and drops ids of deleted rows", async () => {
    const counted = countingClient();
    const games = await counted.igdb.games.select("name", "platforms").findByIds([1942, 1020]);
    const first = await counted.igdb.expand(games, "platforms", counted.igdb.platforms.select("name"));
    expect(first[0]?.platforms?.some((p) => p.name === "PC (Microsoft Windows)")).toBe(true);
    expect(counted.requests).toBe(2);
    await counted.igdb.expand(games, "platforms", counted.igdb.platforms.select("name"));
    expect(counted.requests).toBe(2); // from the cache
    // This event lists game 139713, which no longer exists.
    const [event] = await igdb.events
      .select("games")
      .where((e) => e.games.any(139713))
      .limit(1);
    const [expanded] = await igdb.expand(event ? [event] : [], "games", igdb.games.select("name"));
    expect(expanded?.games?.length).toBe((event?.games?.length ?? 0) - 1);
  });
});
