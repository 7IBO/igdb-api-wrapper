import { describe, expect, test } from "bun:test";
import { ExternalGameSource } from "../../src";
import { mockFetch, testClient } from "./helpers";

// Steam app id "1000" + n belongs to game n; app "1001" has two rows (two platforms).
function api() {
  return mockFetch((call) => {
    if (call.url.endsWith("/external_games")) {
      const uids = [...(call.body.match(/uid = \(([^)]*)\)/)?.[1] ?? "").matchAll(/"([^"]*)"/g)].map(
        (m) => m[1],
      );
      const rows = uids
        .filter((uid) => uid?.startsWith("1"))
        .flatMap((uid) => {
          const game = Number(uid) - 1000;
          const row = { id: game * 10, uid, game };
          return uid === "1001" ? [row, { ...row, id: row.id + 1 }] : [row];
        });
      return Response.json(rows);
    }
    const ids = (call.body.match(/id = \(([^)]*)\)/)?.[1] ?? "").split(",").map(Number);
    return Response.json(ids.map((id) => ({ id, name: `game ${id}` })));
  });
}

describe("findByExternalIds()", () => {
  test("maps each known store id to its game", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const games = await igdb.games
      .select("name")
      .findByExternalIds(ExternalGameSource.Steam, ["1001", 1002, "999"]);
    expect([...games]).toEqual([
      ["1001", { id: 1, name: "game 1" }],
      ["1002", { id: 2, name: "game 2" }],
    ]);
    const lookup = mock.calls.find((c) => c.url.endsWith("/external_games"));
    expect(lookup?.body).toContain(
      'where (external_game_source = 1 & uid = ("1001","1002","999")) & (id > -1);',
    );
  });

  test("splits long id lists", async () => {
    const mock = api();
    const igdb = testClient(mock.fetch);
    const uids = Array.from({ length: 250 }, (_, i) => String(1001 + i));
    const games = await igdb.games.findByExternalIds(ExternalGameSource.Steam, uids);
    expect(games.size).toBe(250);
    const lookups = mock.calls.flatMap((c) => [...c.body.matchAll(/uid = \(/g)]);
    expect(lookups).toHaveLength(3);
  });
});
