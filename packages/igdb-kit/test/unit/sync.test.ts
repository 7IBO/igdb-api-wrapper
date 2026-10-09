import { describe, expect, test } from "bun:test";
import { artworkType, ImageType, imageUrl, QueryError } from "../../src";
import { apicalypseError, type Call, mockFetch, testClient } from "./helpers";

/** A fake endpoint holding `ids`, answering the queries sync() sends. */
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
    return Response.json(rows.slice(0, limit));
  };
}

async function collect<T>(pages: AsyncIterable<T[]>): Promise<T[][]> {
  const out: T[][] = [];
  for await (const page of pages) out.push(page);
  return out;
}

describe("sync", () => {
  test("large sets are fetched as id ranges, packed into multiqueries, in order", async () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => i * 2 + 1); // 1..39999, half the ids exist
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.select("name").sync());
    const seen = pages.flat().map((g) => g.id);
    expect(seen).toEqual(ids);
    expect(pages.every((p) => p.length <= 500)).toBe(true);
    // 80 ranges in multiqueries of up to 10 blocks, plus count and max id.
    expect(mock.calls.length).toBeLessThan(20);
    expect(mock.calls.some((c) => c.url.endsWith("/multiquery"))).toBe(true);
  });

  test("since keeps only what changed, through the cursor when few match", async () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => i + 1);
    const mock = mockFetch(dataset(ids, (id) => (id % 100 === 0 ? 5000 : 1000)));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.sync({ since: new Date(2_000_000) }));
    expect(pages.flat().map((g) => g.id)).toEqual(ids.filter((id) => id % 100 === 0));
    expect(mock.calls.some((c) => c.body.includes("id < "))).toBe(false); // cursor, not ranges
  });

  test("ranges are sized from the density of matches", async () => {
    // 10,000 of 200,000 ids changed: ranges of 8,000 ids hold about 400 rows each.
    const ids = Array.from({ length: 200_000 }, (_, i) => i + 1);
    const mock = mockFetch(dataset(ids, (id) => (id % 20 === 0 ? 5000 : 1000)));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.sync({ since: new Date(2_000_000) }));
    expect(pages.flat().map((g) => g.id)).toEqual(ids.filter((id) => id % 20 === 0));
    expect(pages.every((p) => p.length <= 500)).toBe(true);
    // Count, highest id and first page (ids up to 10,000), then 24 ranges of 8,000 ids in three
    // multiqueries (ranges of 500 ids made 401 blocks in 41 multiqueries).
    expect(mock.calls.map((c) => c.body.split("\n").length)).toEqual([3, 10, 10, 4]);
  });

  test("a range holding more than a page is read on with an id cursor", async () => {
    // 5,500 matches packed at the start, 500 spread up to a million: the first range is dense.
    const ids = [
      ...Array.from({ length: 5_500 }, (_, i) => i + 1),
      ...Array.from({ length: 500 }, (_, i) => 10_000 + i * 1_980),
    ];
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    expect(pages.every((p) => p.length <= 500)).toBe(true);
    // After the first page (ids 1 to 500), ranges of 72,546 ids: the first holds 5,032 rows, read
    // 500 at a time.
    const bodies = mock.calls.flatMap((c) => c.body.split("\n"));
    const first = bodies.filter((b) => b.includes(" & id < 73047;"));
    expect(first.map((b) => Number(b.match(/id > (-?\d+)/)?.[1]))).toEqual([
      500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500,
    ]);
  });

  test("a selection guessed heavy but light is packed into multiqueries from its first page", async () => {
    // companies.* is guessed at 4.5 KB a row, so ranges sent before any answer would go one per
    // request (about 50 here). The first page shows rows of a few bytes.
    const ids = Array.from({ length: 20_000 }, (_, i) => i + 1);
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.companies.select("*").sync());
    expect(pages.flat().map((c) => c.id)).toEqual(ids);
    // Count, highest id and first page, then 49 ranges of 400 ids: 40 at once, 9 as the first 10 end.
    expect(mock.calls.map((c) => c.body.split("\n").length)).toEqual([3, 10, 10, 10, 10, 9]);
  });

  test("heavy pages keep fewer ranges in flight", async () => {
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
    const pages = await collect(heavy.sync({ cursorThreshold: 0 }));
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    // Rows of 30 KB: pages of 133 rows weigh 4 MB, so 12 of them fill the window, 48 MB, and 3
    // more may be read on while the reader waits: 64 MB at most.
    expect(peak).toBe(12);
    expect(pages.every((p) => p.length <= 134)).toBe(true);
  });

  test("an empty result makes one count request", async () => {
    const mock = mockFetch(dataset([]));
    const igdb = testClient(mock.fetch);
    expect(await collect(igdb.games.sync())).toEqual([]);
    expect(mock.calls).toHaveLength(1);
  });

  test("since is refused on endpoints without updated_at", async () => {
    const igdb = testClient(mockFetch(dataset([1])).fetch);
    // @ts-expect-error covers have no updated_at
    const pages = igdb.covers.sync({ since: 0 });
    await expect(pages.next()).rejects.toThrow(QueryError);
  });

  test("a range page IGDB finds too heavy is asked again in smaller pages", async () => {
    const ids = Array.from({ length: 6_000 }, (_, i) => i + 1);
    const handler = dataset(ids);
    const limit = (call: Call) => Number(call.body.match(/limit (\d+)/)?.[1]);
    const mock = mockFetch((call) =>
      limit(call) > 300 && call.body.includes("id < ")
        ? apicalypseError(413, "Payload Too Large", "Response size exceeds maximum allowed")
        : handler(call),
    );
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.select("name").sync({ cursorThreshold: 0 }));
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    // The first ranges ask 500 rows and are refused; then pages of at most 250 pass.
    const sizes = mock.calls
      .flatMap((c) => c.body.split("\n"))
      .filter((b) => b.includes("id < "))
      .map((b) => Number(b.match(/limit (\d+)/)?.[1]));
    const refused = sizes.reduce((last, size, i) => (size > 300 ? i : last), -1);
    expect(refused).toBeGreaterThanOrEqual(0);
    expect(sizes.slice(refused + 1).every((size) => size <= 250)).toBe(true);
  });

  test("a failing range rejects the sync, after the pages before it", async () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => i);
    const handler = dataset(ids);
    const holds3000 = (body: string) => {
      const below = Number(body.match(/id < (\d+)/)?.[1]);
      const after = Number(body.match(/id > (-?\d+)/)?.[1]);
      return after < 3000 && 3000 < below;
    };
    const mock = mockFetch((call) =>
      holds3000(call.body) ? apicalypseError(400, "Syntax Error") : handler(call),
    );
    const igdb = testClient(mock.fetch);
    const seen: number[] = [];
    const error = await (async () => {
      for await (const page of igdb.games.sync()) seen.push(...page.map((g) => g.id));
    })().catch((e) => e);
    expect(error).toBeInstanceOf(QueryError);
    // Ranges of 400 ids after the first page: the one from 2,900 fails.
    expect(seen).toEqual(ids.filter((id) => id < 2900));
  });

  test("ranges holding more than a page are read on ahead, packed with the other requests", async () => {
    // Every id up to 12,000, then one in four up to 60,000: ranges of 1,012 ids hold 3 pages at
    // the start and 253 rows after.
    const ids = Array.from({ length: 60_000 }, (_, i) => i + 1).filter((id) => id <= 12_000 || id % 4 === 0);
    const mock = mockFetch(dataset(ids));
    const igdb = testClient(mock.fetch);
    const pages = await collect(igdb.games.select("name").sync());
    expect(pages.flat().map((g) => g.id)).toEqual(ids);
    // 59 ranges and 23 pages read on, in multiqueries of up to 10.
    const blocks = mock.calls.map((c) => c.body.split("\n").length);
    expect(blocks.reduce((a, b) => a + b, 0)).toBe(3 + 59 + 23);
    expect(mock.calls.length).toBeLessThanOrEqual(12);
  });

  test("a slow reader holds at most a window of pages", async () => {
    // Ranges of 1,012 ids hold 3 pages up to 12,000, then 253 rows.
    const ids = Array.from({ length: 60_000 }, (_, i) => i + 1).filter((id) => id <= 12_000 || id % 4 === 0);
    const handler = dataset(ids);
    let sent = 0;
    let read = 0;
    let most = 0;
    const mock = mockFetch((call) => {
      if (call.body.includes("id < ")) most = Math.max(most, ++sent - read);
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
    expect(read).toBe(59 + 23);
    // 10 pages requested or waiting, 3 more read on while the reader waits on the first range, and
    // the page it waits on.
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
    // The first multiquery, then the first window of 40 ranges.
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
    expect(artworkType(artwork(undefined, undefined))).toBeUndefined();
    expect(artworkType(artwork(undefined, 99))).toBeUndefined();
  });

  test("needs both fields selected", () => {
    // @ts-expect-error artwork_type not selected
    expect(artworkType({ image_type: 1 })).toBe(1);
  });
});
