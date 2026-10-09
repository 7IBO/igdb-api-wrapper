import { describe, expect, test } from "bun:test";
import { NotFoundError } from "../../src";
import { mockFetch, testClient } from "./helpers";

const api = () =>
  mockFetch((call) =>
    Response.json(call.body.includes("id = 1942") ? [{ id: 1942, name: "The Witcher 3" }] : []),
  );

describe("*OrThrow", () => {
  test("return the entity when it exists", async () => {
    const igdb = testClient(api().fetch);
    expect(await igdb.games.select("name").findByIdOrThrow(1942)).toEqual({
      id: 1942,
      name: "The Witcher 3",
    });
    expect(await igdb.games.select("name").where("id = 1942").firstOrThrow()).toEqual({
      id: 1942,
      name: "The Witcher 3",
    });
  });

  test("throw NotFoundError otherwise, in batch() too", async () => {
    const igdb = testClient(api().fetch);
    const error = await igdb.games
      .findByIdOrThrow(7)
      .execute()
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe("No games with id 7");
    expect(error.query).toBe("where id = 7; limit 1;");
    await expect(igdb.games.where("id = 7").firstOrThrow()).rejects.toThrow("No games matched the query");
    await expect(igdb.batch({ a: igdb.games.findByIdOrThrow(7) })).rejects.toBeInstanceOf(NotFoundError);
  });
});
