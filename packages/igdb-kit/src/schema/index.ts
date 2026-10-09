// igdb-kit/schema: IGDB's endpoints and fields as data, to generate the tables of a local copy, check
// stored rows, or describe the API to a tool. Sends no request.
import { fieldSchemas } from "../generated/fields";
import { type EndpointName, endpoints } from "../generated/schema";
import type { FieldSchema } from "./types";

export type { FieldSchema, FieldType } from "./types";

/** An endpoint, its fields, and the fields of other endpoints that point to it. */
export interface EndpointSchema {
  endpoint: EndpointName;
  /** The name of its rows' type in igdb-kit: `Game`, `ReleaseDate`... */
  entity: string;
  /** Whether it accepts `search "..."`. */
  searchable: boolean;
  /** Its fields in IGDB's order, `id` first. */
  fields: FieldSchema[];
  /**
   * The fields of other endpoints that point to its rows: where a local copy needs an index, and
   * what a deletion leaves dangling. `release_dates.game` and `characters.games` point to games.
   */
  linkedFrom: { endpoint: EndpointName; field: string; array: boolean }[];
}

/** Every endpoint name, sorted. */
export const endpointNames: readonly EndpointName[] = Object.freeze(
  (Object.keys(endpoints) as EndpointName[]).sort(),
);

/**
 * An endpoint with its fields, their types and descriptions, and the fields that point to it.
 * Fields IGDB replaced or emptied are left out; those it deprecated but still fills are marked.
 *
 * ```ts
 * import { endpointSchema } from "igdb-kit/schema";
 * endpointSchema("games").fields.find((f) => f.name === "platforms");
 * // { name: "platforms", type: "relation", array: true, endpoint: "platforms", description: "Platforms this game was released on" }
 * ```
 */
export function endpointSchema(endpoint: EndpointName): EndpointSchema {
  const info = endpoints[endpoint];
  if (!info) throw new Error(`Unknown IGDB endpoint: ${endpoint}`);
  const linkedFrom: EndpointSchema["linkedFrom"] = [];
  for (const other of endpointNames) {
    for (const [field, schema] of Object.entries(fieldSchemas[other])) {
      if (schema.type === "relation" && schema.endpoint === endpoint)
        linkedFrom.push({ endpoint: other, field, array: schema.array === true });
    }
  }
  return {
    endpoint,
    entity: info.entity,
    searchable: info.searchable,
    fields: Object.entries(fieldSchemas[endpoint]).map(([name, schema]) => ({ name, ...schema })),
    linkedFrom,
  };
}

/** A JSON Schema (draft 2020-12) object. */
export type JsonSchema = Record<string, unknown>;

/**
 * The JSON Schema of one row of an endpoint as IGDB returns it without expansion: relations are ids,
 * timestamps Unix seconds, every field optional but `id`. For validating stored rows or declaring a
 * tool's output.
 */
export function jsonSchema(endpoint: EndpointName): JsonSchema {
  const schema = endpointSchema(endpoint);
  const properties: Record<string, JsonSchema> = {};
  for (const field of schema.fields) {
    const item: JsonSchema =
      field.type === "relation" || field.type === "timestamp"
        ? { type: "integer" }
        : field.values
          ? { type: "integer", enum: [...new Set(Object.values(field.values))] }
          : { type: field.type };
    const description = [
      field.description?.replace(/(?<![.!?])$/, "."),
      field.type === "relation" && field.endpoint
        ? `${field.array ? "Ids of rows" : "Id of a row"} of ${field.endpoint}.`
        : "",
      field.type === "timestamp" ? "Unix timestamp in seconds." : "",
    ]
      .filter(Boolean)
      .join(" ");
    properties[field.name] = {
      ...(field.array ? { type: "array", items: item } : item),
      ...(description ? { description } : {}),
      ...(field.deprecated ? { deprecated: true } : {}),
    };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: schema.entity,
    description: `A row of IGDB's ${endpoint} endpoint.`,
    type: "object",
    properties,
    required: ["id"],
  };
}
