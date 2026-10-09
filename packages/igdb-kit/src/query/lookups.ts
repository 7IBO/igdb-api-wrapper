import { NotFoundError, QueryError } from "../core/errors";
import { type EndpointName, endpoints, entities } from "../generated/schema";
import { REFERENCE_ENDPOINTS } from "../links/expand";
import {
  type ExecuteOptions,
  MAX_BODY_BYTES,
  MAX_LIMIT,
  Query,
  type QueryRequest,
  type QueryRunner,
} from "./query";
import { literal } from "./where";

/** How long a name lookup is cached: a day, like the reference tables of `expand()`. */
const LOOKUP_TTL_MS = 24 * 3600_000;

interface Row {
  id: number;
  name?: string;
  abbreviation?: string;
  alternative_name?: string;
  developed?: number[];
  published?: number[];
  games?: number[];
}

/** Most suggestions listed for a name that matches nothing. */
const SUGGESTIONS = 5;

/** Fields of a reference table a name is matched on, besides `name`: "PS5" is a platform's abbreviation. */
const otherNames: Partial<Record<EndpointName, (keyof Row)[]>> = {
  platforms: ["abbreviation", "alternative_name"],
};

/**
 * @internal The request with its names replaced by ids. A reference table (`platforms`, `genres`,
 * `themes`...) is read whole, once, and the names matched on it; any other endpoint gets one cached
 * `name ~ "..."` query per distinct name, all sent together so batching packs them. Each name
 * filter becomes `field = (ids)`. A name that matches nothing throws a `NotFoundError` with the rows
 * that contain it, those with the most games first ("Ubisoft" suggests "Ubisoft Entertainment" and
 * "Ubisoft Montreal" before small studios).
 */
export async function resolveLookups(
  request: QueryRequest,
  runner: QueryRunner,
  options: ExecuteOptions = {},
): Promise<QueryRequest> {
  const lookups = request.lookups ?? [];
  if (lookups.length === 0) return request;
  const send: ExecuteOptions = { signal: options.signal, priority: options.priority };
  const namesBy = new Map<EndpointName, string[]>();
  for (const lookup of lookups) {
    const names = namesBy.get(lookup.endpoint) ?? [];
    for (const name of lookup.names) if (!names.includes(name)) names.push(name);
    namesBy.set(lookup.endpoint, names);
  }
  const idsOf = await findNames(runner, namesBy, send, request.body);

  let body = request.body;
  // Longest first: the filter of several names contains the filter of each one.
  for (const lookup of [...lookups].sort((a, b) => b.text.length - a.text.length)) {
    const ids = [
      ...new Set(lookup.names.flatMap((name) => idsOf.get(nameKey(lookup.endpoint, name)) ?? [])),
    ].sort((a, b) => a - b);
    body = body.split(lookup.text).join(`${lookup.field} = (${ids.join(",")})`);
  }
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_BODY_BYTES) {
    throw new QueryError(
      `Query body is ${bytes} bytes once names are replaced by ids, above IGDB's limit of ${MAX_BODY_BYTES}`,
      { endpoint: request.endpoint },
    );
  }
  return { ...request, body, lookups: undefined };
}

/**
 * @internal The ids of the rows of `endpoint` with these names ("PS5" is a platform's abbreviation),
 * matched as a name filter matches them: throws a `NotFoundError` when one matches nothing.
 */
export async function idsNamed(
  runner: QueryRunner,
  endpoint: EndpointName,
  names: readonly string[],
  options: ExecuteOptions = {},
): Promise<number[]> {
  const send: ExecuteOptions = { signal: options.signal, priority: options.priority };
  const idsOf = await findNames(runner, new Map([[endpoint, [...new Set(names)]]]), send);
  return [...new Set(names.flatMap((name) => idsOf.get(nameKey(endpoint, name)) ?? []))];
}

const nameKey = (endpoint: EndpointName, name: string) => `${endpoint} ${name}`;

/** The ids of each name, keyed by `nameKey`; throws when a name matches nothing. */
async function findNames(
  runner: QueryRunner,
  namesBy: Map<EndpointName, string[]>,
  send: ExecuteOptions,
  query?: string,
): Promise<Map<string, number[]>> {
  const idsOf = new Map<string, number[]>();
  const missing: { endpoint: EndpointName; names: string[]; suggestions: string[] }[] = [];
  await Promise.all(
    [...namesBy].map(async ([endpoint, names]) => {
      const found = REFERENCE_ENDPOINTS.has(endpoint)
        ? await fromTable(runner, endpoint, names, send)
        : await byName(runner, endpoint, names, send);
      for (const [name, ids] of found.ids) idsOf.set(nameKey(endpoint, name), ids);
      if (found.missing.length > 0)
        missing.push({ endpoint, names: found.missing, suggestions: found.suggestions });
    }),
  );

  if (missing.length > 0) {
    const list = (values: string[]) => values.map((value) => `"${value}"`).join(", ");
    const message = missing
      .map(({ endpoint, names }) => `No ${label(endpoint)} named ${list(names)}`)
      .join("; ");
    const suggestions = [...new Set(missing.flatMap((m) => m.suggestions))];
    throw new NotFoundError(
      `${message}${suggestions.length > 0 ? `. Close names: ${list(suggestions)}` : ""}`,
      { endpoint: missing[0]?.endpoint, query, suggestions },
    );
  }
  return idsOf;
}

interface Found {
  ids: Map<string, number[]>;
  /** Names that match nothing. */
  missing: string[];
  suggestions: string[];
}

/** Names matched on a whole reference table, read once and cached for a day. */
async function fromTable(
  runner: QueryRunner,
  endpoint: EndpointName,
  names: string[],
  send: ExecuteOptions,
): Promise<Found> {
  const others = otherNames[endpoint] ?? [];
  const rows = await new Query<EndpointName, Row>(runner, endpoint, {
    fields: ["id", "name", ...others],
    sort: { field: "id", direction: "asc" },
    limit: MAX_LIMIT,
    cacheTtlMs: LOOKUP_TTL_MS,
  }).execute(send);
  const texts = (row: Row) => {
    // A platform's alternative names are a list: "PSX, PSOne, PS".
    const all = [row.name, ...others.map((field) => row[field])].flatMap((value, i) =>
      typeof value !== "string" ? [] : i === 0 ? [value] : value.split(","),
    );
    // "Role-playing (RPG)" also answers to "Role-playing" and "RPG", "PC (Microsoft Windows)" to "PC".
    const parts = all.flatMap((text) => /^(.+?)\s*\((.+)\)$/.exec(text.trim())?.slice(1) ?? []);
    return [...all, ...parts].map((text) => text.trim().toLowerCase()).filter((text) => text !== "");
  };
  const ids = new Map<string, number[]>();
  const missing: string[] = [];
  const suggestions: string[] = [];
  for (const name of names) {
    const wanted = name.toLowerCase();
    const matching = rows.filter((row) => texts(row).includes(wanted));
    ids.set(
      name,
      matching.map((row) => row.id),
    );
    if (matching.length > 0) continue;
    missing.push(name);
    for (const row of rows) {
      if (suggestions.length >= SUGGESTIONS * missing.length) break;
      if (row.name && texts(row).some((text) => text.toLowerCase().includes(wanted)))
        suggestions.push(row.name);
    }
  }
  return { ids, missing, suggestions };
}

/** One cached `name ~ "..."` query per name, then the rows that contain the names it misses. */
async function byName(
  runner: QueryRunner,
  endpoint: EndpointName,
  names: string[],
  send: ExecuteOptions,
): Promise<Found> {
  const query = new Query<EndpointName, Row>(runner, endpoint, {
    fields: ["id"],
    limit: MAX_LIMIT,
    cacheTtlMs: LOOKUP_TTL_MS,
  });
  const found = await Promise.all(names.map((name) => query.where(`name ~ ${literal(name)}`).execute(send)));
  const ids = new Map(names.map((name, i) => [name, (found[i] ?? []).map((row) => row.id)]));
  const missing = names.filter((name) => ids.get(name)?.length === 0);
  if (missing.length === 0) return { ids, missing, suggestions: [] };

  // The oldest 500 rows that contain the name, ranked by their number of games.
  const fields = entities[endpoints[endpoint].entity] ?? {};
  const counted = (["developed", "published", "games"] as const).filter((field) => field in fields);
  const close = await Promise.all(
    missing.map((name) =>
      query
        .with({ fields: ["name", ...counted], sort: { field: "id", direction: "asc" } })
        .where(`name ~ *${literal(name)}*`)
        .execute(send),
    ),
  );
  const games = (row: Row) => counted.reduce((sum, field) => sum + (row[field]?.length ?? 0), 0);
  const ranked = close.flatMap((matches) =>
    [...matches].sort((a, b) => games(b) - games(a)).slice(0, SUGGESTIONS),
  );
  const suggestions = [...new Set(ranked.flatMap((row) => (row.name ? [row.name] : [])))];
  return { ids, missing, suggestions };
}

/** "company", "game mode", "player perspective": the endpoint's entity in words. */
function label(endpoint: EndpointName): string {
  return endpoints[endpoint].entity.replace(/(?<=[a-z])(?=[A-Z])/g, " ").toLowerCase();
}
