import { describe, expect, test } from "bun:test";
import { artworkType, ImageType, imageUrl, LocalLimiter, QueryError } from "../../src";
import { apicalypseError, type Call, mockFetch, testClient } from "./helpers";

/** A fake endpoint holding `ids` (in increasing order, read at each call), answering the queries sync() sends. */
function dataset(ids: number[], updatedAt: (id: number) => number = () => 1000, extra: object = {}) {
  return (call: Call) => {
    let rows = ids.map((id) => ({ id, updated_at: updatedAt(id), ...extra }));
    const since = call.body.match(/updated_at >= (\d+)/);
    if (since) rows = rows.filter((r) => r.updated_at >= Number(since[1]));
    const below = call.body.match(/id < (\d+)/);
    if (below) rows = rows.filter((r) => r.id < Number(below[1]));
    const after = call.body.match(/id > (-?\d+)/);
    if (after) rows = rows.filter((r) => r.id > Number(after[1]));
    if (call.url.endsWith("/count")) return Response.json({ count: rows.length });
    if (call.body.includes("sort id desc")) rows = rows.sort((a, b) => b.id - a.id);
    const limit = Number(call.body.match(/limit (\d+)/)?.[1] ?? 10);
    const offset = Number(call.body.match(/offset (\d+)/)?.[1] ?? 0);
    return Response.json(rows.slice(offset, offset + limit));
  };
}

async function collect<T>(pages: AsyncIterable<T[]>): Promise<T[][]> {
  const out: T[][] = [];
  for await (const page of pages) out.push(page);
  return out;
}

const blocksOf = (calls: Call[]) => calls.map((c) => c.body.split("\n").length);
const lines = (calls: Call[]) => calls.flatMap((c) => c.body.split("\n"));

describe("sync", () => {
  test("large sets are read as pages in parallel, packed into multiqueries, in order", async () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => i * 2 + 1); // 1..39999, half the ids exist
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.select("name").sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    expect(pages.every((p) => p.length <= 500)).toBe(true);
    // The count and the first page, then 40 pages of 500 rows, each starting on the last row of the
    // previous one, in multiqueries of 10.
    expect(blocksOf(mock.calls)).toEqual([2, 10, 10, 10, 10]);
    // Each asks for the rows after the first page's last one, skipping those of the pages before.
    expect(mock.calls[1]?.body.split("\n").slice(0, 3)).toEqual([
      'query games "q0" { fields name,id; where id > 999; sort id asc; limit 500; };',
      'query games "q1" { fields name,id; where id > 999; sort id asc; limit 500; offset 499; };',
      'query games "q2" { fields name,id; where id > 999; sort id asc; limit 500; offset 998; };',
    ]);
  });

  test("since keeps only what changed", async () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => i + 1);
    const mock = mockFetch(dataset(ids, (id) => (id % 100 === 0 ? 5000 : 1000)));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.sync({ since: new Date(2_000_000) }));
    expect(pages.flat().map((g) => g.id)).toEqual(ids.filter((id) => id % 100 === 0));
    // 200 rows: the first page holds them all.
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.body).toContain("where (updated_at >= 2000) & (id > -1)");
  });

  test("since takes Unix seconds or a date string, and refuses milliseconds", async () => {
    const mock = mockFetch(dataset([1, 2], (id) => id * 1000));
    const igdb = testClient(mock.fetch);
    expect((await collect(igdb.games.sync({ since: 2000 }))).flat().map((g) => g.id)).toEqual([2]);
    expect((await collect(igdb.games.sync({ since: "1970-01-01T00:16:40Z" }))).flat()).toHaveLength(2);
    expect(mock.calls.map((c) => c.body.match(/updated_at >= \d+/)?.[0])).toEqual([
      "updated_at >= 2000",
      "updated_at >= 1000",
    ]);
    await expect(igdb.games.sync({ since: Date.now() }).next()).rejects.toThrow(/milliseconds/);
  });

  test("pages come back full wherever the ids lie", async () => {
    // 5,500 matches packed at the start, 500 spread up to a million.
    const ids = [
      ...Array.from({ length: 5_500 }, (_, i) => i + 1),
      ...Array.from({ length: 500 }, (_, i) => 10_000 + i * 1_980),
    ];
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.select("name").sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    expect(pages.map((p) => p.length)).toEqual([500, 500, ...Array(10).fill(499), 10]);
    // The count and the first page, then 12 pages at once: no page waits on another.
    expect(blocksOf(mock.calls)).toEqual([2, 10, 2]);
  });

  test("a selection guessed heavy but light is packed into multiqueries from its first page", async () => {
    // companies.* is guessed at 4.5 KB a row, so pages sent before any answer would go one or two
    // per request. The first page shows rows of a few bytes.
    const ids = Array.from({ length: 20_000 }, (_, i) => i + 1);
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.companies.select("*").sync());
    expect(pages.flat().map((c) => c.id)).toEqual(ids);
    expect(blocksOf(mock.calls)).toEqual([2, 10, 10, 10, 10]);
  });

  test("heavy pages keep fewer in flight", async () => {
    const ids = Array.from({ length: 3_000 }, (_, i) => i + 1);
    const handler = dataset(ids, undefined, { name: "x".repeat(30_000) });
    let inFlight = 0;
    let peak = 0;
    const mock = mockFetch(async (call) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return handler(call);
    });
    const igdb = testClient(mock.fetch);
    const heavy = igdb.games.select(
      "*",
      "cover.*",
      "screenshots.*",
      "artworks.*",
      "videos.*",
      "involved_companies.*",
      "release_dates.*",
      "websites.*",
      "age_ratings.*",
      "platforms.name",
      "genres.name",
      "themes.name",
    );
    const pages = await collect(heavy.sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    // Rows of 30 KB: pages of 133 rows weigh 4 MB, so 12 of them fill the window, 48 MB, and 3
    // more may be read on while the reader waits: 64 MB at most.
    expect(peak).toBe(12);
    expect(pages.every((p) => p.length <= 134)).toBe(true);
  });

  test("an empty result makes one request, a page of results two", async () => {
    const mock = mockFetch(dataset([]));
    const igdb = testClient(mock.fetch);
    expect(await collect(igdb.games.sync())).toEqual([]);
    expect(mock.calls).toHaveLength(1);

    // A full first page holding every match: the rows after it are asked for once.
    const full = mockFetch(dataset(Array.from({ length: 500 }, (_, i) => i + 1)));
    expect((await collect(testClient(full.fetch).games.sync())).flat()).toHaveLength(500);
    expect(blocksOf(full.calls)).toEqual([2, 1]);
  });

  test("since is refused on endpoints without updated_at", async () => {
    const igdb = testClient(mockFetch(dataset([1])).fetch);
    // @ts-expect-error covers have no updated_at
    const pages = igdb.covers.sync({ since: 0 });
    await expect(pages.next()).rejects.toThrow(QueryError);
  });

  test("cursorThreshold reads small sets one page after another", async () => {
    const ids = Array.from({ length: 3_000 }, (_, i) => i + 1);
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.select("name").sync({ cursorThreshold: 5000 }));
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    // The count and the first page, then pages after the last id read, the last one empty.
    expect(blocksOf(mock.calls)).toEqual([2, 1, 1, 1, 1, 1, 1]);
    expect(lines(mock.calls).some((b) => b.includes("offset"))).toBe(false);
  });

  test("a page IGDB finds too heavy is asked again in two halves, and later pages are smaller", async () => {
    const ids = Array.from({ length: 6_000 }, (_, i) => i + 1);
    const handler = dataset(ids);
    const limit = (call: Call) => Number(call.body.match(/limit (\d+)/)?.[1]);
    const mock = mockFetch((call) =>
      limit(call) > 300 && !call.body.includes("id > -1")
        ? apicalypseError(413, "Payload Too Large", "Response size exceeds maximum allowed")
        : handler(call),
    );
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.select("name").sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    // The pages after the first ask 500 rows and are refused; then pages of at most 251 pass, half
    // of them and the row two halves share.
    const sizes = lines(mock.calls)
      .filter((b) => !b.includes("id > -1") && b.includes("limit"))
      .map((b) => Number(b.match(/limit (\d+)/)?.[1]));
    const refused = sizes.reduce((last, size, i) => (size > 300 ? i : last), -1);
    expect(refused).toBeGreaterThanOrEqual(0);
    expect(sizes.slice(refused + 1).every((size) => size <= 251)).toBe(true);
  });

  test("pages IGDB times out on are asked again in halves, from the closest row read", async () => {
    const ids = Array.from({ length: 6_000 }, (_, i) => i + 1);
    const handler = dataset(ids);
    // Skipping more than 3,000 rows times out, and fails the whole multiquery.
    const mock = mockFetch((call) =>
      Number(call.body.match(/offset (\d+)/)?.[1] ?? 0) > 3000
        ? Response.json({ message: "Endpoint request timed out" }, { status: 504 })
        : handler(call),
    );
    const igdb = testClient(mock.fetch, { retryTimeoutMs: 1 });
    const pages = await collect(igdb.games.select("name").sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    const asked = lines(mock.calls).map((b) => ({
      after: Number(b.match(/id > (-?\d+)/)?.[1] ?? -1),
      skip: Number(b.match(/offset (\d+)/)?.[1] ?? 0),
    }));
    // The halves of the last pages skip from the end of a page read since, not from id 500.
    expect(Math.max(...asked.map((a) => a.after))).toBeGreaterThan(2000);
    // None starts past the matches.
    expect(asked.every((a) => a.after + a.skip < ids.length)).toBe(true);
  });

  test("a first page IGDB finds too heavy is halved, cursor or not", async () => {
    const ids = Array.from({ length: 2_000 }, (_, i) => i + 1);
    const handler = dataset(ids);
    const tooLarge = () => apicalypseError(413, "Payload Too Large", "Response size exceeds maximum allowed");
    for (const cursorThreshold of [0, 5000]) {
      const mock = mockFetch((call) =>
        Number(call.body.match(/limit (\d+)/)?.[1]) > 300 ? tooLarge() : handler(call),
      );
      const pages = await collect(testClient(mock.fetch).games.select("name").sync({ cursorThreshold }));
      expect(pages.flat().map((g) => g.id)).toEqual(ids);
    }
  });

  test("pages of one row, when one row fills a page, still read every row once", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    const mock = mockFetch(dataset(ids, undefined, { name: "x".repeat(300) }));
    const igdb = testClient(mock.fetch, { maxBatchBytes: 100 });
    const pages = await collect(igdb.games.select("name").sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    expect(pages.every((p) => p.length === 1)).toBe(true);
  });

  test("a failing page rejects the sync, after the pages before it", async () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => i);
    const handler = dataset(ids);
    const mock = mockFetch(async (call) => {
      const response = await handler(call);
      const rows = (await response.clone().json()) as { id: number }[] | { count: number };
      return Array.isArray(rows) && rows.some((row) => row.id === 3000)
        ? apicalypseError(400, "Syntax Error")
        : response;
    });
    const igdb = testClient(mock.fetch);
    const seen: number[] = [];
    const error = await (async () => {
      for await (const page of igdb.games.sync()) seen.push(...page.map((g) => g.id));
    })().catch((e) => e);
    expect(error).toBeInstanceOf(QueryError);
    // Pages of 500 rows from 0 and 500, then every 499: the one from 2,995 fails.
    expect(seen).toEqual(ids.filter((id) => id <= 2995));
  });

  /** A client whose requests go one at a time, running `change` before the third. */
  function changing(ids: number[], change: () => void) {
    const mock = mockFetch(dataset(ids));
    let calls = 0;
    const fetch = ((input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("api.igdb.com") && ++calls === 3) change();
      return mock.fetch(input, init);
    }) as typeof globalThis.fetch;
    const limiter = new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1, rateLimitPauseMs: 1 });
    return { mock, igdb: testClient(fetch, { limiter }) };
  }

  test("rows deleted during the sync shift the pages after them: the rows skipped are read again", async () => {
    const ids = Array.from({ length: 30_000 }, (_, i) => i + 1);
    // Once the first 11 pages are read, 5 rows they hold are deleted: the next pages, which skip a
    // number of rows after id 500, start 5 rows further.
    const { mock, igdb } = changing(ids, () => ids.splice(999, 5));
    const pages = await collect(igdb.games.select("name").sync());
    // Ids 1000 to 1004 were read before they were deleted.
    expect(pages.flat().map((g) => g.id)).toEqual(Array.from({ length: 30_000 }, (_, i) => i + 1));
    expect(lines(mock.calls).filter((b) => b.includes("id < "))).toEqual([
      'query games "q0" { fields name,id; where (id < 5496) & (id > 5491); sort id asc; limit 500; };',
    ]);
  });

  test("rows added during the sync shift the pages after them: rows are not repeated", async () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => (i + 1) * 2);
    const { mock, igdb } = changing(ids, () => ids.splice(500, 0, 1001));
    const pages = await collect(igdb.games.select("name").sync());
    // 1001 was added where the sync had read already.
    expect(pages.flat().map((g) => g.id)).toEqual(Array.from({ length: 10_000 }, (_, i) => (i + 1) * 2));
    expect(lines(mock.calls).some((b) => b.includes("id < "))).toBe(false);
  });

  test("rows added after the last match are read on when the last page comes back full", async () => {
    const ids = Array.from({ length: 1_000 }, (_, i) => i + 1);
    const handler = dataset(ids);
    const mock = mockFetch((call) => {
      const response = handler(call);
      if (call.url.endsWith("/count")) ids.push(...Array.from({ length: 600 }, (_, i) => 1_001 + i));
      return response;
    });
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.select("name").sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    // Two pages for the 500 rows left by the count; the second is full, so the rest follows.
    expect(blocksOf(mock.calls)).toEqual([2, 2, 1]);
  });

  test("a slow reader holds at most a window of pages", async () => {
    const ids = Array.from({ length: 60_000 }, (_, i) => i + 1).filter((id) => id <= 12_000 || id % 4 === 0);
    const handler = dataset(ids);
    let sent = 0;
    let read = 0;
    let most = 0;
    const mock = mockFetch((call) => {
      if (!call.url.endsWith("/count") && !call.body.includes("id > -1"))
        most = Math.max(most, ++sent - read);
      return handler(call);
    });
    const igdb = testClient(mock.fetch);
    let first = true;
    for await (const page of igdb.games.select("name").sync({ concurrency: 10 })) {
      if (!first) read++;
      first = false;
      expect(page.length).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    // 24,000 rows: two pages of 500, then 47 that start on the last row of the previous one.
    expect(read).toBe(48);
    // 10 pages requested or waiting, 3 more read on while the reader waits on the first, and the
    // page it waits on.
    expect(most).toBeLessThanOrEqual(14);
  });

  test("stopping early sends no more requests", async () => {
    const ids = Array.from({ length: 50_000 }, (_, i) => i + 1);
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    let pages = 0;
    for await (const _ of igdb.games.select("name").sync()) if (++pages === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const sent = mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mock.calls.length).toBe(sent);
    // The first multiquery, then the first window of 40 pages.
    expect(sent).toBeLessThanOrEqual(5);
  });
});

describe("imageUrl", () => {
  test("builds sized, retina and format variants", () => {
    expect(imageUrl("co1wyy")).toBe("https://images.igdb.com/igdb/image/upload/t_thumb/co1wyy.jpg");
    expect(imageUrl("co1wyy", "cover_big", { retina: true, format: "webp" })).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1wyy.webp",
    );
    expect(imageUrl(undefined, "720p")).toBeUndefined();
  });

  test("accepts the url field IGDB returns", () => {
    expect(imageUrl("//images.igdb.com/igdb/image/upload/t_thumb/co1wyy.jpg", "cover_big")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg",
    );
    expect(imageUrl("https://images.igdb.com/igdb/image/upload/t_720p/sc6abc.png", "1080p")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_1080p/sc6abc.jpg",
    );
    expect(() => imageUrl("https://example.com/a/b.jpg")).toThrow(/Not an IGDB image/);
  });
});

describe("artworkType", () => {
  // As a query returns them with both fields selected: a missing one comes back undefined.
  const artwork = (
    image_type: number | { id: number } | undefined,
    artwork_type: number | { id: number } | undefined,
  ) => ({
    image_type,
    artwork_type,
  });

  test("reads image_type, else converts artwork_type to its numbering", () => {
    expect(artworkType(artwork(ImageType.KeyArtWithLogo, 3))).toBe(3);
    expect(artworkType(artwork({ id: ImageType.Icon }, 12))).toBe(ImageType.Icon);
    // 8 is Infographic in artwork_types and Main cover in image_types; 9 and 10 are swapped.
    expect(artworkType(artwork(undefined, 8))).toBe(ImageType.Infographic);
    expect(artworkType(artwork(undefined, 9))).toBe(ImageType.AlternativeCover);
    expect(artworkType(artwork(undefined, { id: 10 }))).toBe(ImageType.HistoricalCover);
    expect(artworkType(artwork(undefined, 15))).toBe(ImageType.HistoricalArtwork);
    expect(artworkType(artwork(undefined, 4))).toBe(ImageType.ConceptArt);
    expect(artworkType(artwork(undefined, undefined))).toBeNull();
    expect(artworkType(artwork(undefined, 99))).toBeNull();
  });

  test("needs both fields selected", () => {
    // @ts-expect-error artwork_type not selected
    expect(artworkType({ image_type: 1 })).toBe(1);
  });
});
