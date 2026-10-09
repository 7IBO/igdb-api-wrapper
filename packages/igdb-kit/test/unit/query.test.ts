import { describe, expect, test } from "bun:test";
import {
  AgeRatingCategory,
  ArtworkType,
  and,
  CompanySize,
  GameType,
  Language,
  or,
  Platform,
  QueryError,
  Region,
  ReleaseDateRegion,
  ReleaseDateStatus,
  toDate,
  toUnix,
} from "../../src";
import { mockFetch, testClient } from "./helpers";

const igdb = testClient(mockFetch(() => Response.json([])).fetch);

describe("Apicalypse compilation", () => {
  test("select, where, sort, limit, offset", () => {
    const q = igdb.games
      .select("name", "cover.image_id", "platforms.*")
      .where((g) => g.rating.gte(80))
      .sort("first_release_date", "desc")
      .limit(20)
      .offset(40);
    expect(q.toApicalypse()).toBe(
      "fields name,cover.image_id,platforms.*; where rating >= 80; sort first_release_date desc; limit 20; offset 40;",
    );
  });

  test("no select sends no fields line (IGDB returns ids)", () => {
    expect(igdb.genres.limit(5).toApicalypse()).toBe("limit 5;");
  });

  test("where filters", () => {
    const w = (fn: Parameters<typeof igdb.games.where>[0]) => igdb.games.where(fn).toApicalypse();
    expect(w((g) => g.name.eq('Say "hi"'))).toBe('where name = "Say \\"hi\\"";');
    expect(w((g) => g.name.startsWith("Super"))).toBe('where name ~ "Super"*;');
    expect(w((g) => g.name.endsWith("World", { caseSensitive: true }))).toBe('where name = *"World";');
    expect(w((g) => g.name.contains("smash"))).toBe('where name ~ *"smash"*;');
    expect(w((g) => g.cover.isNull())).toBe("where cover = null;");
    expect(w((g) => g.summary.notNull())).toBe("where summary != null;");
    expect(w((g) => g.platforms.any(48, 49, 6))).toBe("where platforms = (48,49,6);");
    expect(w((g) => g.platforms.all(6, 48))).toBe("where platforms = [6,48];");
    expect(w((g) => g.themes.none(42))).toBe("where themes != (42);");
    expect(() => w((g) => g.themes.notAll(1, 2))).toThrow(QueryError);
    expect(w((g) => g.tags.exactly(1, 2))).toBe("where tags = {1,2};");
    expect(w((g) => g.id.in(1, 2))).toBe("where id = (1,2);");
    expect(w((g) => g.release_dates.platform.eq(6))).toBe("where release_dates.platform = 6;");
    expect(w((g) => g.platforms.name.eq("PC"))).toBe('where platforms.name = "PC";');
  });

  test("and / or nest with parentheses", () => {
    const q = igdb.games.where((g) =>
      or(and(g.platforms.all(6, 48), g.genres.any(13)), and(g.platforms.all(130, 48), g.genres.any(12))),
    );
    expect(q.toApicalypse()).toBe(
      "where (platforms = [6,48] & genres = (13)) | (platforms = [130,48] & genres = (12));",
    );
    expect(igdb.games.where((g) => g.rating.gt(1).or(g.hypes.gt(2))).toApicalypse()).toBe(
      "where rating > 1 | hypes > 2;",
    );
  });

  test("successive where calls are combined with &", () => {
    expect(
      igdb.games
        .where("a = 1")
        .where((g) => g.rating.gt(2))
        .toApicalypse(),
    ).toBe("where (a = 1) & (rating > 2);");
  });

  test("search is quoted and count drops fields, sort and limit", () => {
    expect(igdb.games.select("name").search('zel"da').toApicalypse()).toBe('fields name; search "zel\\"da";');
    const count = igdb.games
      .select("name")
      .where((g) => g.rating.gt(90))
      .limit(3)
      .count()
      .toRequest();
    expect(count.path).toBe("games/count");
    expect(count.body).toBe("where rating > 90;");
  });

  test("queries are immutable", () => {
    const base = igdb.games.select("name");
    base.limit(3);
    expect(base.toApicalypse()).toBe("fields name;");
  });
});

describe("reference constants", () => {
  test("name the ids of reference tables", () => {
    expect(GameType.MainGame).toBe(0);
    expect(Platform.PlayStation5).toBe(167);
    expect(igdb.games.where((g) => g.game_type.in(GameType.MainGame, GameType.Remake)).toApicalypse()).toBe(
      "where game_type = (0,8);",
    );
  });

  test("labels that repeat or make poor names get a readable key", () => {
    // Ratings repeat across organizations: the key starts with it.
    expect([AgeRatingCategory.PEGI_18, AgeRatingCategory.USK_18, AgeRatingCategory.ESRB_E10]).toEqual([
      12, 22, 4,
    ]);
    expect([AgeRatingCategory.GRAC_18, AgeRatingCategory.GRAC_19]).toEqual([40, 26]); // "18+" and "19+"
    expect([CompanySize.Employees0To1, CompanySize.Employees5000Plus]).toEqual([1, 8]);
    expect([Language.ChineseSimplified, Language.PortugueseBrazil, Language.English]).toEqual([2, 21, 7]);
    // Ids are not contiguous: regions start at 2, release statuses jump from 6 to 34.
    expect(Region).toEqual({ Korea: 2, Japan: 3, Europe: 4 });
    expect(ReleaseDateStatus.NextGenOptimizationPatchRelease).toBe(36);
  });
});

describe("exclude", () => {
  test("one exclude line after fields, nested paths included, merged across calls", () => {
    const q = igdb.games
      .select("*", "cover.*")
      .exclude("summary", "cover.url", "summary")
      .exclude("storyline")
      .where((g) => g.id.eq(1942));
    expect(q.toApicalypse()).toBe("fields *,cover.*; exclude summary,cover.url,storyline; where id = 1942;");
    expect(q.count().toApicalypse()).toBe("where id = 1942;");
    expect(igdb.games.select("name", "summary").exclude("summary").select("name").toApicalypse()).toBe(
      "fields name;",
    );
  });

  test("only selected fields, never id, *, or an expanded relation (IGDB rejects or ignores them)", () => {
    // @ts-expect-error not selected
    expect(() => igdb.games.select("name").exclude("summary")).toThrow(/"summary": it is not selected/);
    // @ts-expect-error cover is an id here, its fields are not selected
    expect(() => igdb.games.select("*").exclude("cover.url")).toThrow(/not selected/);
    // @ts-expect-error id is always returned
    expect(() => igdb.games.select("*").exclude("id")).toThrow(/always returns "id"/);
    // @ts-expect-error also nested
    expect(() => igdb.games.select("cover.*").exclude("cover.id")).toThrow(/always returns "cover.id"/);
    // @ts-expect-error wildcard
    expect(() => igdb.games.select("cover.*").exclude("cover.*")).toThrow(/"\*" in exclude/);
    // @ts-expect-error expanded relation
    expect(() => igdb.games.select("*", "cover.image_id").exclude("cover")).toThrow(/remove its fields/);
    // @ts-expect-error unknown field: IGDB would silently ignore it
    expect(() => igdb.games.select("*").exclude("nope")).toThrow(/Unknown field "nope"/);
    // A relation selected as an id can be excluded; so can a field selected by name.
    expect(igdb.games.select("*").exclude("cover").toApicalypse()).toBe("fields *; exclude cover;");
    expect(
      igdb.games
        .select("involved_companies.company.*")
        .exclude("involved_companies.company.url")
        .toApicalypse(),
    ).toBe("fields involved_companies.company.*; exclude involved_companies.company.url;");
  });
});

describe("game filters", () => {
  const w = (fn: Parameters<typeof igdb.games.where>[0]) => igdb.games.where(fn).toApicalypse();

  test("company roles rely on IGDB matching one involved company for both conditions", () => {
    expect(w((g) => g.developedBy(908))).toBe(
      "where involved_companies.company = (908) & involved_companies.developer = true;",
    );
    expect(w((g) => or(g.publishedBy(50, 248), g.rating.gt(90)))).toBe(
      "where (involved_companies.company = (50,248) & involved_companies.publisher = true) | rating > 90;",
    );
    expect(() => w((g) => g.developedBy(-1))).toThrow(/Invalid company id/);
    expect(() => w((g) => g.developedBy())).toThrow(QueryError);
  });

  test("company roles take company names, matched in full and ignoring case", () => {
    expect(w((g) => g.developedBy("CD Projekt RED"))).toBe(
      'where involved_companies.company.name ~ "CD Projekt RED" & involved_companies.developer = true;',
    );
    expect(w((g) => g.publishedBy("Square Enix", 'Say "hi"'))).toBe(
      'where (involved_companies.company.name ~ "Square Enix" | involved_companies.company.name ~ "Say \\"hi\\"") & involved_companies.publisher = true;',
    );
    const mixed = [908, "Square Enix"] as unknown as number[];
    expect(() => w((g) => g.developedBy(...mixed))).toThrow(/ids or company names, not both/);
  });

  test("releasedIn: the release vocabulary of releases(), with statuses", () => {
    expect(
      w((g) =>
        g.releasedIn({
          platforms: Platform.PlayStation5,
          regions: [ReleaseDateRegion.Europe, ReleaseDateRegion.Japan],
          from: "2026-01-01",
          to: "2027-01-01",
        }),
      ),
    ).toBe(
      "where release_dates.platform = (167) & release_dates.release_region = (1,5,8) & " +
        "release_dates.date >= 1767225600 & release_dates.date < 1798761600 & " +
        "(release_dates.status = null | release_dates.status != (4,5));",
    );
    expect(w((g) => g.releasedIn({ regions: ReleaseDateRegion.Europe, includeWorldwide: false }))).toBe(
      "where release_dates.release_region = (1) & (release_dates.status = null | release_dates.status != (4,5));",
    );
    expect(w((g) => g.releasedIn({ platforms: [6], statuses: [ReleaseDateStatus.EarlyAccess, null] }))).toBe(
      "where release_dates.platform = (6) & (release_dates.status = (3) | release_dates.status = null);",
    );
    expect(w((g) => g.releasedIn({ statuses: ReleaseDateStatus.FullRelease }))).toBe(
      "where release_dates.status = (6);",
    );
    expect(w((g) => g.releasedIn({ statuses: [null] }))).toBe("where release_dates.status = null;");
    // The new names win over the deprecated ones.
    expect(
      w((g) => g.releasedIn({ platforms: 6, platform: 48, statuses: [6], includeCancelled: true })),
    ).toBe("where release_dates.platform = (6) & release_dates.status = (6);");
    expect(() => w((g) => g.releasedIn({ platforms: [] }))).toThrow(/platforms must not be empty/);
    expect(() => w((g) => g.releasedIn({ statuses: [-1] }))).toThrow(/Invalid id in statuses/);
  });

  test("releasedIn: one release date matching every option, worldwide included, cancelled left out", () => {
    expect(
      w((g) =>
        g.releasedIn({
          platform: Platform.PlayStation5,
          region: [ReleaseDateRegion.Europe, ReleaseDateRegion.Japan],
          from: new Date("2026-01-01T00:00:00Z"),
          to: 1798761600,
        }),
      ),
    ).toBe(
      "where release_dates.platform = (167) & release_dates.release_region = (1,5,8) & " +
        "release_dates.date >= 1767225600 & release_dates.date < 1798761600 & " +
        "(release_dates.status = null | release_dates.status != (4,5));",
    );
    expect(
      w((g) => g.releasedIn({ region: ReleaseDateRegion.Europe, worldwide: false, includeCancelled: true })),
    ).toBe("where release_dates.release_region = (1);");
    expect(w((g) => g.releasedIn({}))).toBe(
      "where (release_dates.status = null | release_dates.status != (4,5));",
    );
    expect(w((g) => g.releasedIn({ includeCancelled: true }))).toBe("where release_dates != null;");
    expect(w((g) => and(g.releasedIn({ platform: 6 }), g.developedBy(908)))).toBe(
      "where (release_dates.platform = (6) & (release_dates.status = null | release_dates.status != (4,5))) & " +
        "(involved_companies.company = (908) & involved_companies.developer = true);",
    );
    expect(() => w((g) => g.releasedIn({ from: new Date("nope") }))).toThrow(/Invalid Date/);
    expect(w((g) => g.releasedIn({ from: "2026-01-01", to: "2027-01-01", includeCancelled: true }))).toBe(
      "where release_dates.date >= 1767225600 & release_dates.date < 1798761600;",
    );
    expect(() => w((g) => g.releasedIn({ to: Date.now() }))).toThrow(/releasedIn\(\) to .* milliseconds/);
  });

  test("only on the root of games", () => {
    // @ts-expect-error not on other endpoints
    expect(() => igdb.platforms.where((p) => p.developedBy(1))).toThrow(/Unknown field "developedBy"/);
    // @ts-expect-error not on nested games
    expect(() => igdb.games.where((g) => g.similar_games.developedBy(1))).toThrow(/Unknown field/);
  });
});

describe("timestamps", () => {
  test("a Date in where becomes Unix seconds", () => {
    const date = new Date("2026-01-01T00:00:00.999Z");
    expect(igdb.games.where((g) => g.first_release_date.gte(date)).toApicalypse()).toBe(
      "where first_release_date >= 1767225600;",
    );
    expect(igdb.games.where((g) => g.release_dates.date.in(date, 1767312000)).toApicalypse()).toBe(
      "where release_dates.date = (1767225600,1767312000);",
    );
    expect(() => igdb.games.where((g) => g.first_release_date.gt(new Date("nope")))).toThrow(/Invalid Date/);
  });

  test("timestamp fields take date strings and seconds, and refuse milliseconds", () => {
    const w = (fn: Parameters<typeof igdb.games.where>[0]) => igdb.games.where(fn).toApicalypse();
    expect(w((g) => g.first_release_date.gte("2026-01-01"))).toBe("where first_release_date >= 1767225600;");
    expect(w((g) => g.first_release_date.lt("2026-01-01T00:00:00.999Z"))).toBe(
      "where first_release_date < 1767225600;",
    );
    expect(w((g) => g.first_release_date.eq(1767225600))).toBe("where first_release_date = 1767225600;");
    expect(w((g) => g.release_dates.date.notIn("2026-01-01", 1767312000))).toBe(
      "where release_dates.date != (1767225600,1767312000);",
    );
    expect(() => w((g) => g.first_release_date.gte(Date.now()))).toThrow(/looks like milliseconds/);
    expect(() => w((g) => g.first_release_date.gte("soon"))).toThrow(/Invalid first_release_date: "soon"/);
    // Only timestamps are dates: other numbers are left alone.
    expect(w((g) => g.total_rating_count.gte(1e12))).toBe("where total_rating_count >= 1000000000000;");
    expect(igdb.popularity_primitives.where((p) => p.calculated_at.gte("2026-10-01")).toApicalypse()).toBe(
      "where calculated_at >= 1790812800;",
    );
    expect(igdb.companies.where((c) => c.start_date.lt("2000-01-01")).toApicalypse()).toBe(
      "where start_date < 946684800;",
    );
  });

  test("between() is on or after from, before to, and nests in and()", () => {
    const w = (fn: Parameters<typeof igdb.games.where>[0]) => igdb.games.where(fn).toApicalypse();
    expect(w((g) => g.first_release_date.between("2026-01-01", new Date("2027-01-01T00:00:00Z")))).toBe(
      "where first_release_date >= 1767225600 & first_release_date < 1798761600;",
    );
    expect(w((g) => or(g.release_dates.date.between(1767225600, 1798761600), g.rating.gte(80)))).toBe(
      "where (release_dates.date >= 1767225600 & release_dates.date < 1798761600) | rating >= 80;",
    );
  });

  test("toUnix and toDate convert between dates and seconds", () => {
    expect(toUnix(new Date("2026-01-01T00:00:00.999Z"))).toBe(1767225600);
    expect(toUnix("2026-01-01")).toBe(1767225600);
    expect(toUnix(1767225600)).toBe(1767225600);
    expect(() => toUnix(Date.now())).toThrow(QueryError);
    expect(toDate(1767225600).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("client-side validation", () => {
  test("unknown fields are rejected before sending", () => {
    // @ts-expect-error unknown field
    expect(() => igdb.games.select("nom")).toThrow(QueryError);
    // @ts-expect-error not a relation
    expect(() => igdb.games.select("name.x")).toThrow(/not a relation/);
    // @ts-expect-error unknown nested field
    expect(() => igdb.games.select("cover.nope")).toThrow(/Cover has no field "nope"/);
    // @ts-expect-error unknown field in where
    expect(() => igdb.games.where((g) => g.nope.eq(1))).toThrow(/Unknown field "nope"/);
  });

  test("fields IGDB replaced are rejected with their replacement (it matches nothing otherwise)", () => {
    // @ts-expect-error removed field
    expect(() => igdb.games.select("category")).toThrow(
      '"category" was replaced by IGDB and is empty or no longer updated: use "game_type" instead',
    );
    // @ts-expect-error removed nested field
    expect(() => igdb.games.select("release_dates.region")).toThrow(/use "release_region"/);
    // @ts-expect-error removed field in where
    expect(() => igdb.games.where((g) => g.category.eq(0))).toThrow(/use "game_type"/);
    // @ts-expect-error removed nested field in where
    expect(() => igdb.games.where((g) => g.external_games.category.eq(1))).toThrow(
      /use "external_game_source"/,
    );
    // @ts-expect-error removed field in sort
    expect(() => igdb.release_dates.sort("region")).toThrow(/use "release_region"/);
    // @ts-expect-error removed without replacement
    expect(() => igdb.games.select("follows")).toThrow('"follows" was dropped by IGDB and is always empty');
  });

  test("artworks.artwork_type stays: IGDB still fills it, unlike its replacement image_type", () => {
    const query = igdb.artworks
      .select("image_type", "artwork_type")
      .where((a) => a.artwork_type.eq(ArtworkType.ConceptArt));
    expect(query.toApicalypse()).toBe("fields image_type,artwork_type; where artwork_type = 4;");
  });

  test("sort only on scalar fields (IGDB silently ignores bad sorts)", () => {
    // @ts-expect-error relation
    expect(() => igdb.games.sort("cover")).toThrow(/relation/);
    // IGDB silently ignores a sort on a relation's field.
    expect(() => igdb.games.sort("cover.width" as "name")).toThrow(/IGDB ignores sort on "cover.width"/);
  });

  test("limit is bounded to 0..500", () => {
    expect(() => igdb.games.limit(501)).toThrow(/between 0 and 500/);
    expect(() => igdb.games.limit(-1)).toThrow(QueryError);
    expect(() => igdb.games.limit(1.5)).toThrow(QueryError);
    expect(igdb.games.limit(500).toApicalypse()).toBe("limit 500;");
  });

  test("search and sort are mutually exclusive", () => {
    expect(() => igdb.games.search("zelda").sort("name")).toThrow(/sort with search/);
    expect(() => igdb.games.sort("name").search("zelda")).toThrow(/sort with search/);
  });

  test("request bodies above 32,000 bytes are rejected", () => {
    const ids = Array.from({ length: 6000 }, (_, i) => 100000 + i);
    expect(() => igdb.games.where(`id = (${ids.join(",")})`).toApicalypse()).toThrow(
      /above IGDB.s limit of 32000/,
    );
    // IGDB accepts 32,000 bytes and answers 413 from 32,001 on.
    const sized = (bytes: number) => {
      const empty = igdb.games.where('name = ""').toApicalypse().length;
      return igdb.games.where(`name = "${"x".repeat(bytes - empty)}"`);
    };
    expect(sized(32_000).toApicalypse()).toHaveLength(32_000);
    expect(() => sized(32_001).toApicalypse()).toThrow("Query body is 32001 bytes");
  });
});

describe("terminals", () => {
  test("first, findById, findByIds, withCount", async () => {
    const mock = mockFetch((call) => {
      if (call.body.includes("id = (")) {
        const ids =
          call.body
            .match(/id = \(([^)]*)\)/)?.[1]
            ?.split(",")
            .map(Number) ?? [];
        return Response.json(ids.filter((id) => id !== 3).map((id) => ({ id })));
      }
      return Response.json([{ id: 7, name: "x" }], { headers: { "x-count": "1234" } });
    });
    const client = testClient(mock.fetch);
    expect(await client.games.select("name").first()).toEqual({ id: 7, name: "x" });
    expect(mock.calls[0]?.body).toBe("fields name; limit 1;");
    await client.games.findById(7);
    expect(mock.calls[1]?.body).toBe("where id = 7; limit 1;");
    expect(await client.games.select("name").withCount()).toEqual({
      data: [{ id: 7, name: "x" }],
      total: 1234,
    });

    const ids = Array.from({ length: 1200 }, (_, i) => 1200 - i);
    const found = await client.games.findByIds(ids);
    expect(found.map((g) => g.id)).toEqual(ids.filter((id) => id !== 3));
    // Three chunks of at most 500 ids, sent together as one multiquery.
    expect(mock.calls).toHaveLength(4);
    expect(mock.calls[3]?.url).toEndWith("/multiquery");
    expect([...(mock.calls[3]?.body.matchAll(/limit (\d+)/g) ?? [])].map((m) => m[1]).sort()).toEqual([
      "200",
      "500",
      "500",
    ]);
  });

  test("lookups by id ignore the query's offset and sort", async () => {
    const mock = mockFetch((call) => Response.json([{ id: Number(call.body.match(/id = \(?(\d+)/)?.[1]) }]));
    const client = testClient(mock.fetch);
    const paged = client.games.select("name").sort("name").offset(20);
    expect(paged.findById(7).toApicalypse()).toBe("fields name; where id = 7; limit 1;");
    expect(paged.findByIdOrThrow(7).toApicalypse()).toBe("fields name; where id = 7; limit 1;");
    expect(await paged.findById(7)).toEqual({ id: 7 });
    expect(await paged.findByIds([7])).toEqual([{ id: 7 }]);
    expect(mock.calls.map((call) => call.body)).toEqual([
      "fields name; where id = 7; limit 1;",
      "fields name; where id = (7); limit 1;",
    ]);
    // The query itself keeps them.
    expect(paged.toApicalypse()).toBe("fields name; sort name asc; offset 20;");
  });

  test("iterate pages with an id cursor", async () => {
    const all = Array.from({ length: 23 }, (_, i) => ({ id: i * 2 + 1 }));
    const mock = mockFetch((call) => {
      const after = Number(call.body.match(/id > (-?\d+)/)?.[1]);
      const limit = Number(call.body.match(/limit (\d+)/)?.[1]);
      return Response.json(all.filter((g) => g.id > after).slice(0, limit));
    });
    const client = testClient(mock.fetch);
    const seen: number[] = [];
    for await (const g of client.games.select("name").iterate({ pageSize: 10 })) seen.push(g.id);
    expect(seen).toEqual(all.map((g) => g.id));
    expect(mock.calls[0]?.body).toBe("fields name,id; where id > -1; sort id asc; limit 10;");
    expect(mock.calls[1]?.body).toContain("where id > 19;");
    expect(mock.calls).toHaveLength(3);
  });
});
