import { describe, expect, test } from "bun:test";
import { type EndpointName, endpoints, entities } from "../../src";
import { endpointNames, endpointSchema, jsonSchema } from "../../src/schema";

describe("igdb-kit/schema", () => {
  test("describes each field with its type, target, values and deprecation", () => {
    const games = endpointSchema("games");
    expect(games).toMatchObject({ endpoint: "games", entity: "Game", searchable: true });
    const field = (endpoint: EndpointName, name: string) =>
      endpointSchema(endpoint).fields.find((f) => f.name === name);
    expect(games.fields[0]).toEqual({ name: "id", type: "integer" });
    expect(field("games", "platforms")).toMatchObject({
      type: "relation",
      array: true,
      endpoint: "platforms",
    });
    expect(field("games", "first_release_date")?.type).toBe("timestamp");
    expect(field("games", "name")?.type).toBe("string");
    expect(field("games", "rating")?.type).toBe("number");
    expect(field("involved_companies", "developer")?.type).toBe("boolean");
    expect(field("game_version_features", "category")).toMatchObject({
      type: "integer",
      values: { BOOLEAN: 0, DESCRIPTION: 1 },
    });
    // Replaced fields are left out; deprecated ones IGDB still fills are marked.
    expect(field("games", "category")).toBeUndefined();
    expect(field("artworks", "artwork_type")).toMatchObject({ type: "relation", deprecated: true });
  });

  test("lists the fields that point to an endpoint", () => {
    const linked = endpointSchema("games").linkedFrom;
    expect(linked).toContainEqual({ endpoint: "release_dates", field: "game", array: false });
    expect(linked).toContainEqual({ endpoint: "characters", field: "games", array: true });
    expect(linked).toContainEqual({ endpoint: "games", field: "version_parent", array: false });
    expect(endpointSchema("companies").linkedFrom).toContainEqual({
      endpoint: "companies",
      field: "parent",
      array: false,
    });
  });

  test("agrees with the query layer's schema on every endpoint", () => {
    expect(endpointNames).toEqual((Object.keys(endpoints) as EndpointName[]).sort());
    for (const endpoint of endpointNames) {
      const schema = endpointSchema(endpoint);
      const runtime = entities[endpoints[endpoint].entity] ?? {};
      expect(schema.fields.map((f) => f.name).sort()).toEqual(Object.keys(runtime).sort());
      for (const f of schema.fields) {
        if (f.type === "relation") {
          expect(f.endpoint && endpoints[f.endpoint].entity).toBe(runtime[f.name] as string);
        } else expect(runtime[f.name]).toBe(0);
      }
    }
  });

  test("gives a JSON Schema of a row, relations as ids", () => {
    const schema = jsonSchema("release_dates");
    expect(schema).toMatchObject({ title: "ReleaseDate", type: "object", required: ["id"] });
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.game).toEqual({
      type: "integer",
      description: expect.stringContaining("Id of a row of games."),
    });
    expect(properties.date?.description).toContain("Unix timestamp in seconds.");
    expect(jsonSchema("games").properties).toMatchObject({
      platforms: { type: "array", items: { type: "integer" } },
    });
    expect(() => endpointSchema("nope" as EndpointName)).toThrow(/Unknown IGDB endpoint/);
  });
});
