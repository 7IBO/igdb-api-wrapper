import { describe, expect, test } from "bun:test";
import { and, GameType, or, Platform, QueryError, toDate, toUnix } from "../../src";
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
    expect(w((g) => g.themes.notAll(1, 2))).toBe("where themes = ![1,2];");
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

  test("toUnix and toDate convert between Date and seconds", () => {
    expect(toUnix(new Date("2026-01-01T00:00:00.999Z"))).toBe(1767225600);
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
      '"category" was removed from Game by IGDB and is always empty: use "game_type" instead',
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
    expect(() => igdb.games.select("follows")).toThrow(/always empty$/);
  });

  test("sort only on scalar fields (IGDB silently ignores bad sorts)", () => {
    // @ts-expect-error relation
    expect(() => igdb.games.sort("cover")).toThrow(/relation/);
    expect(igdb.games.sort("cover.width").toApicalypse()).toBe("sort cover.width asc;");
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

  test("request bodies above 32 KB are rejected", () => {
    const ids = Array.from({ length: 6000 }, (_, i) => 100000 + i);
    expect(() => igdb.games.where(`id = (${ids.join(",")})`).toApicalypse()).toThrow(/32 KB/);
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
