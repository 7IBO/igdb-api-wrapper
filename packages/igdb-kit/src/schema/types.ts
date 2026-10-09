import type { EndpointName } from "../generated/schema";

/**
 * The type of a field in IGDB's rows: `timestamp` is Unix seconds, `relation` the id of a row of
 * another endpoint (or the row itself when expanded).
 */
export type FieldType = "string" | "integer" | "number" | "boolean" | "timestamp" | "relation";

/** One field of an endpoint, from IGDB's protobuf schema and docs. */
export interface FieldSchema {
  name: string;
  type: FieldType;
  /** A list: `platforms`, `genres`, `alternative_names`... */
  array?: boolean;
  /** The endpoint a relation points to. */
  endpoint?: EndpointName;
  /** The names of an integer that holds one of a few values (`game_version_features.category`). */
  values?: Record<string, number>;
  /** IGDB's description of the field. */
  description?: string;
  /** IGDB deprecated the field but still fills it. Fields it replaced or emptied are left out. */
  deprecated?: boolean;
}
