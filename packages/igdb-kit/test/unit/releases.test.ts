import { describe, expect, test } from "bun:test";
import { Platform, QueryError, ReleaseDateRegion, ReleaseDateStatus } from "../../src";
import { calendarWhere, type ReleaseRow, toCalendarRelease } from "../../src/query/releases";
import { mockFetch, testClient } from "./helpers";

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
const window = (from: string, to: string) => ({ from: day(from) * 1000, to: day(to) * 1000 });

// Shapes as IGDB returns them: `d` is never filled, `status` is missing on most rows, TBD rows have no
// date nor y/m, a YYYY date is December 31st (or January 1st on old rows), a quarter its last day.
const rows: ReleaseRow[] = [
  // Veyrasol: a beta then the full release, several platforms, all in October.
  {
    id: 1,
    game: 413754,
    date: day("2026-10-19"),
    date_format: 0,
    human: "Oct 19, 2026",
    platform: 6,
    release_region: 8,
    status: 2,
    y: 2026,
    m: 10,
  },
  {
    id: 2,
    game: 413754,
    date: day("2026-10-29"),
    date_format: 0,
    human: "Oct 29, 2026",
    platform: 167,
    release_region: 8,
    status: 6,
    y: 2026,
    m: 10,
  },
  {
    id: 3,
    game: 413754,
    date: day("2026-10-27"),
    date_format: 0,
    human: "Oct 27, 2026",
    platform: 6,
    release_region: 8,
    status: 6,
    y: 2026,
    m: 10,
  },
  // Same day worldwide and in Japan: one entry.
  {
    id: 4,
    game: 500,
    date: day("2026-10-01"),
    date_format: 0,
    human: "Oct 01, 2026",
    platform: 167,
    release_region: 8,
    y: 2026,
    m: 10,
  },
  {
    id: 5,
    game: 500,
    date: day("2026-10-01"),
    date_format: 0,
    human: "Oct 01, 2026",
    platform: 167,
    release_region: 5,
    y: 2026,
    m: 10,
  },
  // Month, quarter and year precision, stored inside their period.
  {
    id: 6,
    game: 600,
    date: day("2026-10-01"),
    date_format: 1,
    human: "Oct 2026",
    platform: 6,
    release_region: 8,
    y: 2026,
    m: 10,
  },
  {
    id: 7,
    game: 700,
    date: day("2026-12-31"),
    date_format: 6,
    human: "Q4 2026",
    platform: 6,
    release_region: 8,
    status: 3,
    y: 2026,
    m: 12,
  },
  {
    id: 8,
    game: 800,
    date: day("2026-12-31"),
    date_format: 2,
    human: "2026",
    platform: 6,
    release_region: 8,
    y: 2026,
    m: 12,
  },
  // A month release that also has an exact day: the exact day places the game.
  {
    id: 9,
    game: 900,
    date: day("2026-10-01"),
    date_format: 1,
    human: "Oct 2026",
    platform: 48,
    release_region: 2,
    y: 2026,
    m: 10,
  },
  {
    id: 10,
    game: 900,
    date: day("2026-10-20"),
    date_format: 0,
    human: "Oct 20, 2026",
    platform: 6,
    release_region: 8,
    status: 6,
    y: 2026,
    m: 10,
  },
  // TBD, a deleted game, and a row IGDB sent twice.
  { id: 11, game: 1100, date_format: 7, human: "TBD", platform: 6, release_region: 8 },
  {
    id: 12,
    game: 999,
    date: day("2026-10-05"),
    date_format: 0,
    human: "Oct 05, 2026",
    platform: 6,
    release_region: 8,
  },
  {
    id: 4,
    game: 500,
    date: day("2026-10-01"),
    date_format: 0,
    human: "Oct 01, 2026",
    platform: 167,
    release_region: 8,
    y: 2026,
    m: 10,
  },
];

/** Returns every fixture row whatever the where (the calendar re-checks each row), paged by id. */
function api(data: ReleaseRow[], options: { total?: number } = {}) {
  return mockFetch((call) => {
    if (call.url.endsWith("/release_dates/count"))
      return Response.json({ count: options.total ?? data.length });
    if (call.url.endsWith("/release_dates")) {
      const limit = Number(call.body.match(/limit (\d+);/)?.[1] ?? 10);
      const offset = Number(call.body.match(/offset (\d+);/)?.[1] ?? 0);
      return Response.json(data.slice(offset, offset + limit));
    }
    const ids = (call.body.match(/id = \(([^)]*)\)/)?.[1] ?? "").split(",").map(Number);
    return Response.json(ids.filter((id) => id !== 999).map((id) => ({ id, name: `game ${id}` })));
  });
}

describe("releases()", () => {
  test("one entry per game, placed by its most precise then earliest release", async () => {
    const mock = api(rows);
    const igdb = testClient(mock.fetch);
    const calendar = await igdb.games.select("name").releases({ from: "2026-10-01", to: "2026-11-01" });
    expect(calendar.map((e) => [e.game.id, e.release.human, e.release.precision])).toEqual([
      [500, "Oct 01, 2026", "day"],
      [600, "Oct 2026", "month"], // starts on October 1st, after the exact days of October 1st
      [413754, "Oct 19, 2026", "day"],
      [900, "Oct 20, 2026", "day"],
    ]);
    const veyrasol = calendar[2];
    expect(veyrasol?.game).toEqual({ id: 413754, name: "game 413754" });
    expect(veyrasol?.releases.map((r) => [r.id, r.status])).toEqual([
      [1, ReleaseDateStatus.Beta],
      [3, ReleaseDateStatus.FullRelease],
      [2, ReleaseDateStatus.FullRelease],
    ]);
    expect(calendar[0]?.releases.map((r) => [r.region, r.status])).toEqual([
      [8, null],
      [5, null],
    ]);
    expect(calendar[3]?.releases.map((r) => r.precision)).toEqual(["month", "day"]);
    expect(calendar[1]?.release).toEqual({
      id: 6,
      precision: "month",
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-11-01T00:00:00Z"),
      year: 2026,
      quarter: null,
      month: 10,
      day: null,
      human: "Oct 2026",
      platform: 6,
      region: 8,
      status: null,
    });
    expect(calendar[2]?.release).toMatchObject({ year: 2026, quarter: null, month: 10, day: 19 });
  });

  test("a quarter or a year is in a window that holds it whole, or overlaps it with match: overlap", async () => {
    const igdb = testClient(api(rows).fetch);
    const quarter = await igdb.games.releases({ from: "2026-10-01", to: "2027-01-01" });
    expect(quarter.map((e) => e.game.id)).toContain(700);
    expect(quarter.map((e) => e.game.id)).not.toContain(800);
    const overlap = await igdb.games.releases({ from: "2026-10-01", to: "2026-10-02", match: "overlap" });
    expect(overlap.map((e) => [e.game.id, e.release.precision])).toEqual([
      [800, "year"],
      [500, "day"],
      [600, "month"],
      [900, "month"],
      [700, "quarter"],
    ]);
  });

  test("TBD releases only when asked, sorted last", async () => {
    const igdb = testClient(api(rows).fetch);
    const calendar = await igdb.games.releases({
      from: "2026-10-01",
      to: "2026-11-01",
      precision: ["day", "tbd"],
    });
    expect(calendar.at(-1)?.release).toMatchObject({
      precision: "tbd",
      start: null,
      end: null,
      human: "TBD",
    });
    expect(calendar.map((e) => e.game.id)).not.toContain(600);
  });

  test("counts first, reads pages in parallel, and refuses more than maxRows", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      ...(rows[3] as ReleaseRow),
      id: i + 1,
      game: 2000 + i,
    }));
    const mock = api(many);
    const calendar = await testClient(mock.fetch).games.releases({ from: "2026-10-01", to: "2026-10-02" });
    expect(calendar).toHaveLength(1200);
    const pages = mock.calls.flatMap((c) => c.body.match(/sort id asc; limit 500;( offset \d+;)?/g) ?? []);
    expect(pages.sort()).toEqual([
      "sort id asc; limit 500;",
      "sort id asc; limit 500; offset 1000;",
      "sort id asc; limit 500; offset 500;",
    ]);
    const huge = testClient(api(rows, { total: 25_000 }).fetch);
    await expect(huge.games.releases({ from: "2026-01-01", to: "2027-01-01" })).rejects.toThrow(/maxRows/);
  });

  test("the query's limit and offset page the entries; sort throws", async () => {
    const igdb = testClient(api(rows).fetch);
    const october = { from: "2026-10-01", to: "2026-11-01" };
    expect((await igdb.games.limit(2).offset(1).releases(october)).map((e) => e.game.id)).toEqual([
      600, 413754,
    ]);
    expect((await igdb.games.offset(3).releases(october)).map((e) => e.game.id)).toEqual([900]);
    expect(await igdb.games.limit(0).releases(october)).toEqual([]);
    await expect(igdb.games.sort("name").releases(october)).rejects.toThrow(/remove sort\(\)/);
  });

  test("validates its input", async () => {
    const igdb = testClient(api(rows).fetch);
    await expect(igdb.games.releases({ from: "2026-11-01", to: "2026-10-01" })).rejects.toThrow(/after/);
    await expect(igdb.games.releases({ from: "soon", to: "2026-10-01" })).rejects.toThrow(QueryError);
    await expect(igdb.games.releases({ from: Date.now(), to: "2027-10-01" })).rejects.toThrow(/milliseconds/);
    await expect(
      igdb.games.releases({ from: "2026-10-01", to: "2026-11-01", platforms: [] }),
    ).rejects.toThrow(/platforms/);
    await expect(
      igdb.games.search("zelda").releases({ from: "2026-10-01", to: "2026-11-01" }),
    ).rejects.toThrow(/search/);
    // @ts-expect-error only on games
    await expect(igdb.platforms.releases({ from: "2026-10-01", to: "2026-11-01" })).rejects.toThrow(
      /only on games/,
    );
  });
});

describe("calendarWhere()", () => {
  const oct = window("2026-10-01", "2026-11-01");

  test("defaults: dated precisions in the window, no Offline or Cancelled (dates without status kept)", () => {
    expect(calendarWhere(oct, {})).toBe(
      "(date_format = (0,1,2,3,4,5,6) & date >= 1790812800 & date < 1793491200) & (status != (4,5))",
    );
  });

  test("overlap widens each precision to whole periods", () => {
    expect(
      calendarWhere(window("2026-10-10", "2026-10-11"), { match: "overlap", precision: ["day", "month"] }),
    ).toBe(
      "((date_format = 0 & date >= 1791590400 & date < 1791676800) | " +
        "(date_format = 1 & date >= 1790812800 & date < 1793491200)) & (status != (4,5))",
    );
    expect(
      calendarWhere(oct, { match: "overlap", precision: ["day", "month", "quarter", "year", "tbd"] }),
    ).toBe(
      // October is a whole month: months widen to the same range as days.
      "((date_format = (0,1) & date >= 1790812800 & date < 1793491200) | " +
        "(date_format = (3,4,5,6) & date >= 1790812800 & date < 1798761600) | " +
        "(date_format = 2 & date >= 1767225600 & date < 1798761600) | (date = null)) & (status != (4,5))",
    );
  });

  test("platforms, regions with worldwide, statuses with unknown", () => {
    expect(
      calendarWhere(oct, {
        precision: ["day"],
        platforms: [Platform.PlayStation5, Platform.PlayStation5],
        regions: [ReleaseDateRegion.Europe],
        statuses: [ReleaseDateStatus.FullRelease, ReleaseDateStatus.EarlyAccess, null],
      }),
    ).toBe(
      "(date_format = 0 & date >= 1790812800 & date < 1793491200) & (platform = (167)) & " +
        "(release_region = (1,8)) & ((status = (6,3) | status = null))",
    );
    expect(
      calendarWhere(oct, { precision: ["tbd"], regions: [5], includeWorldwide: false, statuses: [null] }),
    ).toBe("(date = null) & (release_region = (5)) & (status = null)");
    // One id works as a list of one.
    expect(
      calendarWhere(oct, {
        precision: ["day"],
        platforms: Platform.PlayStation5,
        regions: ReleaseDateRegion.Europe,
        statuses: ReleaseDateStatus.FullRelease,
      }),
    ).toBe(
      "(date_format = 0 & date >= 1790812800 & date < 1793491200) & (platform = (167)) & " +
        "(release_region = (1,8)) & (status = (6))",
    );
    expect(() => calendarWhere(oct, { statuses: [] })).toThrow(QueryError);
    expect(() => calendarWhere(oct, { platforms: [] })).toThrow(/platforms must not be empty/);
    expect(() => calendarWhere(oct, { precision: [] })).toThrow(QueryError);
    // @ts-expect-error not a precision
    expect(() => calendarWhere(oct, { precision: ["week"] })).toThrow(/week/);
  });
});

describe("toCalendarRelease()", () => {
  test("periods by date_format, from y and m", () => {
    const period = (row: Omit<ReleaseRow, "id">) => {
      const r = toCalendarRelease({ id: 1, ...row });
      return [r.precision, r.start?.toISOString().slice(0, 10), r.end?.toISOString().slice(0, 10)];
    };
    expect(period({ date: day("2026-10-19"), date_format: 0 })).toEqual(["day", "2026-10-19", "2026-10-20"]);
    expect(period({ date: day("2026-10-01"), date_format: 1, y: 2026, m: 10 })).toEqual([
      "month",
      "2026-10-01",
      "2026-11-01",
    ]);
    expect(period({ date: day("2026-03-31"), date_format: 3, y: 2026, m: 3 })).toEqual([
      "quarter",
      "2026-01-01",
      "2026-04-01",
    ]);
    expect(period({ date: day("2026-12-31"), date_format: 6, y: 2026, m: 12 })).toEqual([
      "quarter",
      "2026-10-01",
      "2027-01-01",
    ]);
    // A year is December 31st on recent rows and January 1st on 50 old ones.
    expect(period({ date: day("2027-12-31"), date_format: 2, y: 2027, m: 12 })).toEqual([
      "year",
      "2027-01-01",
      "2028-01-01",
    ]);
    expect(period({ date: day("1993-01-01"), date_format: 2, y: 1993, m: 1 })).toEqual([
      "year",
      "1993-01-01",
      "1994-01-01",
    ]);
    // Without y and m, from the date; before 1970 dates are negative.
    expect(period({ date: day("1962-05-01"), date_format: 1 })).toEqual([
      "month",
      "1962-05-01",
      "1962-06-01",
    ]);
    // A format IGDB may add later is treated as the year, never as a precise day.
    expect(period({ date: day("2026-06-15"), date_format: 8 })).toEqual(["year", "2026-01-01", "2027-01-01"]);
    expect(period({ date_format: 7, human: "TBD" })).toEqual(["tbd", undefined, undefined]);
  });

  test("window bounds are UTC days", async () => {
    const mock = api([]);
    const igdb = testClient(mock.fetch);
    // Midnight in New York is 04:00 UTC: still October 1st. 12:00 UTC on Oct 31 ends with Oct 31.
    await igdb.games.releases({
      from: new Date("2026-10-01T00:00:00-04:00"),
      to: new Date("2026-10-31T12:00:00Z"),
    });
    expect(mock.calls[0]?.body).toContain("date >= 1790812800 & date < 1793491200");
    // Unix seconds, rounded to UTC days too.
    await igdb.games.releases({ from: 1790812800 + 3600, to: 1793491200 - 3600 });
    expect(mock.calls[1]?.body).toContain("date >= 1790812800 & date < 1793491200");
  });
});
