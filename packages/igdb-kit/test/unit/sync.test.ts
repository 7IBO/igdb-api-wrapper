import { describe, expect, test } from "bun:test";
import { imageUrl, QueryError } from "../../src";
import { type Call, mockFetch, testClient } from "./helpers";

/** A fake endpoint holding `ids`, answering the queries sync() sends. */
function dataset(ids: number[], updatedAt: (id: number) => number = () => 1000) {
  return (call: Call) => {
    let rows = ids.map((id) => ({ id, updated_at: updatedAt(id) }));
    const since = call.body.match(/updated_at >= (\d+)/);
    if (since) rows = rows.filter((r) => r.updated_at >= Number(since[1]));
    const range = call.body.match(/id >= (\d+) & id < (\d+)/);
    if (range) rows = rows.filter((r) => r.id >= Number(range[1]) && r.id < Number(range[2]));
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
    expect(mock.calls.some((c) => c.body.includes("id >="))).toBe(false); // cursor, not ranges
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

  test("a failing range rejects the sync", async () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => i);
    const handler = dataset(ids);
    const mock = mockFetch((call) =>
      call.body.includes("id >= 3000 &")
        ? Response.json({ message: "boom" }, { status: 400 })
        : handler(call),
    );
    const igdb = testClient(mock.fetch);
    await expect(collect(igdb.games.sync())).rejects.toThrow();
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
