// Runs against the real IGDB API. Skipped unless TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set.
// Uses about 45 requests. The webhook test registers webhooks on example.com and removes them.
import { describe, expect, test } from "bun:test";
import {
  AgeRatingCategory,
  AgeRatingOrganization,
  and,
  createIGDB,
  ExternalGameSource,
  GameType,
  or,
  Platform,
  PopularityType,
  QueryError,
  Region,
  ReleaseDateStatus,
  SEARCH_GAME_TYPES,
  Theme,
  TierError,
  toDate,
} from "../../src";
import { igdbProxy } from "../../src/proxy";

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;

// The describe body runs even when skipped, so only build the client when credentials exist.
const igdb = clientId && clientSecret ? createIGDB({ clientId, clientSecret }) : (undefined as never);

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

  test("popular() returns games by PopScore, filtered by the query", async () => {
    const top = await igdb.games
      .select("name", "game_type")
      .where((g) => g.game_type.eq(GameType.MainGame))
      .popular(PopularityType.IGDBPlaying, { limit: 5 });
    expect(top).toHaveLength(5);
    expect(top.every((t) => t.game.game_type === GameType.MainGame && typeof t.game.name === "string")).toBe(
      true,
    );
    const values = top.map((t) => t.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
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
      platforms,
    ] = await Promise.all([
      ids(witcher.where((g) => g.developedBy(908))),
      ids(witcher.where((g) => g.developedBy(50))), // WB Games only published it
      ids(witcher.where((g) => g.publishedBy(50))),
      ids(
        witcher.where((g) => g.releasedIn({ platform: Platform.NintendoSwitch, to: new Date("2020-01-01") })),
      ),
      ids(
        witcher.where((g) =>
          g.releasedIn({ platform: Platform.NintendoSwitch, from: new Date("2021-01-01") }),
        ),
      ),
      // 214992: every release date is Cancelled, yet its platforms still list Xbox Series X|S.
      ids(witcher.where((g) => g.releasedIn({ platform: Platform.XboxSeriesXS }))),
      ids(witcher.where((g) => g.releasedIn({ platform: Platform.XboxSeriesXS, includeCancelled: true }))),
      ids(witcher.where((g) => g.platforms.any(Platform.XboxSeriesXS))),
    ]);
    expect(byCdpr).toEqual([1942]);
    expect(byWb).toEqual([]);
    expect(publishedByWb).toEqual([1942]);
    expect(switchBefore2020).toEqual([]); // the PS4 release is before 2020, the Switch one is not
    expect(switchSince2021).toEqual([1942]);
    expect(cancelledOnly).toEqual([1942]);
    expect(withCancelled.sort()).toEqual([1942, 214992]);
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
      expect(SEARCH_GAME_TYPES).toContain(hit.game.game_type as number);
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
});
