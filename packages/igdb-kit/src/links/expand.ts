import { QueryError } from "../core/errors";
import { type EndpointName, entities } from "../generated/schema";
import { type ExecuteOptions, MAX_LIMIT, type Query, toId } from "../query/query";
import type { Prettify } from "../query/types";

/**
 * Small reference tables that rarely change (measured October 2026: 220 platforms, 28 languages,
 * 23 genres, 3 regions…, all under 500 rows). `expand()` loads them whole once and keeps them in
 * the client's cache, so expanding their ids usually costs no request.
 */
export const REFERENCE_ENDPOINTS: ReadonlySet<EndpointName> = new Set<EndpointName>([
  "age_rating_categories",
  "age_rating_content_description_types",
  "age_rating_content_descriptions_v2",
  "age_rating_organizations",
  "artwork_types",
  "character_genders",
  "character_species",
  "collection_membership_types",
  "collection_relation_types",
  "collection_types",
  "company_sizes",
  "company_statuses",
  "company_types",
  "date_formats",
  "external_game_sources",
  "game_modes",
  "game_release_formats",
  "game_statuses",
  "game_types",
  "genres",
  "image_types",
  "language_support_types",
  "languages",
  "network_types",
  "platform_families",
  "platform_types",
  "platforms",
  "player_perspectives",
  "popularity_types",
  "regions",
  "release_date_regions",
  "release_date_statuses",
  "themes",
  "website_types",
]);

/** How long `expand()` keeps a reference table when its query sets no `cache()`: a day. */
export const REFERENCE_TTL_MS = 24 * 3600_000;

/** Keys of `T` holding ids (a number or an array of numbers), which `expand()` can replace. */
export type IdKeys<T> = Exclude<
  { [K in keyof T]-?: NonNullable<T[K]> extends number | readonly number[] ? K : never }[keyof T],
  "id"
> &
  string;

type Swap<V, E> = V extends readonly unknown[] ? E[] : V extends number ? E : V;

/** `T` with the ids under `K` replaced by the rows `E` they point to. */
export type Expanded<T, K extends keyof T, E> = Prettify<{
  [P in keyof T]: P extends K ? Swap<T[P], E> : T[P];
}>;

/**
 * Replaces the ids under `key` in each row by the entities `target` returns for them, with its
 * fields. Ids are deduplicated across rows and fetched in one batched call (500 per query); an
 * entity used by several rows is the same object in each. Ids pointing to rows that no longer exist
 * (or that the target's `where` excludes) are dropped from arrays, and a single id is removed.
 *
 * A reference table (`platforms`, `genres`, `themes`, `game_modes`, `languages`, `regions`…, see
 * `REFERENCE_ENDPOINTS`) is loaded whole and cached for a day in the client's cache (or as long as
 * the target's `cache()` says), so later calls cost nothing; `cache(false)` fetches by id instead.
 */
export async function expand<T extends object, K extends IdKeys<T>, N extends EndpointName, E>(
  rows: readonly T[],
  key: K,
  target: Query<N, E>,
  options?: ExecuteOptions,
): Promise<Expanded<T, K, E>[]> {
  if (valueFields().has(key)) {
    throw new QueryError(`expand() replaces ids of a relation, and ${key} holds values in IGDB's rows`);
  }
  const ids = new Set<number>();
  for (const row of rows) for (const id of idsOf(row[key])) ids.add(toId(id));
  const found = await load(target as never as Query<EndpointName, E>, [...ids], options);
  return rows.map((row) => {
    const value = row[key] as unknown;
    if (value === undefined || value === null) return { ...row } as Expanded<T, K, E>;
    const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    if (Array.isArray(value)) {
      copy[key] = idsOf(value).flatMap((id) => (found.has(id) ? [found.get(id)] : []));
    } else if (found.has(idsOf(value)[0] as number)) {
      copy[key] = found.get(idsOf(value)[0] as number);
    } else {
      delete copy[key];
    }
    return copy as Expanded<T, K, E>;
  });
}

let values: Set<string> | undefined;

/**
 * Fields that hold values in every IGDB entity that has them, never ids of a relation: `tags`,
 * `hypes`, `country`, `first_release_date`... `..._id` fields such as `game_id` are ids. Keys of your
 * own rows that IGDB does not have are accepted.
 */
function valueFields(): Set<string> {
  if (values) return values;
  const relations = new Set<string>();
  const scalars = new Set<string>();
  for (const fields of Object.values(entities)) {
    for (const [field, type] of Object.entries(fields)) (type === 0 ? scalars : relations).add(field);
  }
  values = new Set([...scalars].filter((field) => !relations.has(field) && !field.endsWith("_id")));
  return values;
}

/** Ids in a value: a number, an array of numbers, or objects already expanded. */
function idsOf(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map((v) => (typeof v === "object" && v !== null ? (v as { id: number }).id : (v as number)));
}

async function load<E>(
  target: Query<EndpointName, E>,
  ids: number[],
  options: ExecuteOptions | undefined,
): Promise<Map<number, E>> {
  const byId = (entities: E[]) => new Map(entities.map((e) => [(e as { id: number }).id, e]));
  const { cacheTtlMs, search, limit, offset, sort } = target.state;
  const whole =
    REFERENCE_ENDPOINTS.has(target.endpoint) &&
    cacheTtlMs !== 0 &&
    [search, limit, offset, sort].every((v) => v === undefined);
  if (ids.length === 0) return new Map();
  if (!whole) return byId(await target.findByIds(ids).execute(options));

  const table = byId(
    await target
      .with({
        sort: { field: "id", direction: "asc" },
        limit: MAX_LIMIT,
        cacheTtlMs: cacheTtlMs ?? REFERENCE_TTL_MS,
      })
      .execute(options),
  );
  // An id the cached table lacks is new since it was cached, or points to a deleted row.
  const missing = ids.filter((id) => !table.has(id));
  if (missing.length > 0)
    for (const [id, e] of byId(await target.findByIds(missing).execute(options))) table.set(id, e);
  return table;
}
