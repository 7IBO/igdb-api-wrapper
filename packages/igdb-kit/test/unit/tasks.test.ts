import { describe, expect, test } from "bun:test";
import { ExternalGameSource, PopularityType, Task } from "../../src";
import { type Call, mockFetch, testClient } from "./helpers";

/** IGDB with nothing in it: empty lists, and counts of 0. */
const empty = (call: Call) => (call.url.endsWith("/count") ? Response.json({ count: 0 }) : Response.json([]));

describe("tasks", () => {
  test("the methods that take several requests send nothing before they are awaited", async () => {
    const mock = mockFetch(empty);
    const igdb = testClient(mock.fetch);
    const tasks = [
      igdb.games.findByIds([1]),
      igdb.games.findByExternalIds(ExternalGameSource.Steam, ["292030"]),
      igdb.games.popular(PopularityType.IGDBVisits),
      igdb.games.weightedPopular({ [PopularityType.IGDBVisits]: 1 }),
      igdb.games.releases({ from: "2026-10-01", to: "2026-11-01" }),
      igdb.release_dates.findByGames([1]),
      igdb.searchAll("zelda"),
      igdb.expand([{ id: 1, platforms: [6] }], "platforms", igdb.platforms.select("name").cache(false)),
    ] as const;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mock.calls).toHaveLength(0);
    for (const task of tasks) expect(task).toBeInstanceOf(Task);
    const [ids, external, popular, weighted, releases, dates, hits, expanded] = await Promise.all(tasks);
    expect(mock.calls.length).toBeGreaterThan(0);
    expect([ids, popular, weighted, releases, hits]).toEqual([[], [], [], [], []]);
    expect(external).toEqual(new Map());
    expect(dates).toEqual(new Map([[1, []]]));
    expect(expanded).toEqual([{ id: 1, platforms: [] }]);
  });

  test("awaiting a task sends its requests once; execute() sends them again", async () => {
    const mock = mockFetch(() => Response.json([{ id: 1, name: "Zelda" }]));
    const igdb = testClient(mock.fetch);
    const task = igdb.games.select("name").findByIds([1]);
    expect(await task).toEqual([{ id: 1, name: "Zelda" }]);
    expect(await task.then((games) => games.length)).toBe(1);
    expect(await task.finally(() => {})).toEqual([{ id: 1, name: "Zelda" }]);
    expect(mock.calls).toHaveLength(1);
    expect(await task.execute()).toEqual([{ id: 1, name: "Zelda" }]);
    expect(mock.calls).toHaveLength(2);
    expect(Object.prototype.toString.call(task)).toBe("[object Task]");
  });

  test("a failed task rejects every await with its error, and catch() handles it", async () => {
    const mock = mockFetch(() => Response.json([]));
    const igdb = testClient(mock.fetch);
    const task = igdb.games.releases({ from: "2026-11-01", to: "2026-10-01" });
    expect(await task.catch((error: unknown) => (error as Error).message)).toMatch(/after/);
    await expect(Promise.resolve(task)).rejects.toThrow(/after/);
    await expect(task.execute()).rejects.toThrow(/after/);
    expect(mock.calls).toHaveLength(0);
  });

  test("batch() runs tasks with queries, and their first requests share one multiquery", async () => {
    const mock = mockFetch((call) =>
      call.url.endsWith("/count")
        ? Response.json({ count: 3 })
        : Response.json(call.url.endsWith("/release_dates") ? [{ id: 7, game: 1 }] : [{ id: 1 }]),
    );
    const igdb = testClient(mock.fetch, { autoBatch: false });
    const result = await igdb.batch({
      games: igdb.games.findByIds([1]),
      dates: igdb.release_dates.findByGames([1]),
      platforms: igdb.platforms.count(),
    });
    expect(mock.calls.map((call) => call.url.split("/").pop())).toEqual(["multiquery"]);
    expect(result).toEqual({
      games: [{ id: 1 }],
      // The link to the game is only read to group rows: it was not selected.
      dates: new Map([[1, [{ id: 7 }]]]),
      platforms: 3,
    });
  });

  test("every task applies the request options given to execute()", async () => {
    const mock = mockFetch(empty);
    const igdb = testClient(mock.fetch);
    const aborted = AbortSignal.abort(new Error("stop"));
    const tasks = [
      igdb.games.findByIds([1]),
      igdb.games.findByExternalIds(ExternalGameSource.Steam, ["292030"]),
      igdb.games.popular(PopularityType.IGDBVisits),
      igdb.games.weightedPopular({ [PopularityType.IGDBVisits]: 1 }),
      igdb.games.releases({ from: "2026-10-01", to: "2026-11-01" }),
      igdb.release_dates.findByGames([1]),
      igdb.searchAll("zelda"),
      igdb.expand([{ id: 1, platforms: [6] }], "platforms", igdb.platforms.cache(false)),
    ];
    for (const task of tasks) await expect(task.execute({ signal: aborted })).rejects.toThrow("stop");
    expect(mock.calls).toHaveLength(0);
  });
});
