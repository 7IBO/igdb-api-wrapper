import { QueryError } from "../core/errors";
import { type EndpointName, type Endpoints, endpoints, entities, type Game } from "../generated/schema";
import { type ExecuteOptions, endpointEntity, type Query, toId, tooHeavy } from "../query/query";
import type { Unarray } from "../query/types";

/** The field of `E` that points to games: a `game` or `games` relation, or a `game_id` number. */
type GameLinkKey<E> = {
  [K in keyof E]-?: K extends "game" | "games"
    ? Unarray<NonNullable<E[K]>> extends Game
      ? K
      : never
    : K extends "game_id"
      ? K
      : never;
}[keyof E];

/**
 * Endpoints whose rows point to games, which `byGame()` and views can group by game: through a
 * `game` relation (`release_dates`, `websites`, `language_supports`…), a `games` array (`characters`,
 * `events`, `collections`, `franchises`) or a `game_id` number (`game_time_to_beats`,
 * `popularity_primitives`). `search` is left out: it only answers with a search term.
 */
export type GameLinkedEndpoint = Exclude<
  { [N in EndpointName]: [GameLinkKey<Endpoints[N]>] extends [never] ? never : N }[EndpointName],
  "search"
>;

/**
 * The field linking an endpoint's rows to games, read from the schema: `game` first (`game_versions`
 * also has `games`, its editions), then `game_id`, then `games`. Undefined when there is none.
 */
export function gameLink(endpoint: EndpointName): string | undefined {
  if (endpoint === "search" || !(endpoint in endpoints)) return undefined;
  const fields = entities[endpointEntity(endpoint)] ?? {};
  if (fields.game === "Game") return "game";
  if (fields.game_id === 0) return "game_id";
  if (fields.games === "Game") return "games";
  return undefined;
}

type Row = Record<string, unknown> & { id: number };

/**
 * Rows of `query` linked to each of `gameIds`, with the query's fields and `where`. Every requested
 * id is in the map, with an empty array when nothing points to it. A row linked to several of the
 * games (a character in two games) is the same object under each. The query's `sort` and `limit`
 * apply to each game's rows; without `sort`, rows are in id order.
 *
 * Ids are sent 500 per query, and the first pages go out together so batching packs them into
 * multiqueries. Pages hold 500 rows, fewer when the selected rows are heavy. A query that fills its
 * page is counted, then split into smaller id lists sized from the count and read in parallel; a
 * single game with more rows than a page is read with an id cursor. A page IGDB finds too heavy is
 * split in two by its ids, or read with smaller pages for a single game.
 */
export async function byGame<R>(
  query: Query<EndpointName, R>,
  gameIds: readonly number[],
  options: ExecuteOptions = {},
): Promise<Map<number, R[]>> {
  const link = gameLink(query.endpoint);
  if (link === undefined)
    throw new QueryError(`byGame() needs an endpoint linked to games, not ${query.endpoint}`);
  const { fields, search, offset, sort, limit } = query.state;
  if (search !== undefined) throw new QueryError("byGame() cannot be combined with search");
  if (offset !== undefined)
    throw new QueryError("byGame() cannot be combined with offset: use limit, per game");

  const ids = [...new Set(gameIds.map(toId))];
  const result = new Map<number, R[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;
  /** Ids per query: the filter on 500 games stays far under IGDB's body limit. */
  const chunkSize = 500;

  // The link field is needed to group rows; it is removed again unless the query selected it.
  const selectsLink =
    fields.length === 0 ? false : fields.some((f) => f === "*" || f === link || f.startsWith(`${link}.`));
  const base = query.with({
    fields: selectsLink ? fields : [...new Set([...(fields.length ? fields : ["id"]), link])],
    sort: { field: "id", direction: "asc" },
    limit: undefined,
    offset: undefined,
  });
  const rows = base.pageRows();

  const found = new Map<number, Row>();
  const keep = (page: Row[]) => {
    for (const row of page) found.set(row.id, row);
  };
  const filtered = (chunk: number[]) => base.where(`${link} = (${chunk.join(",")})`);
  /** The rest of one game's rows, after `after`, in pages that halve while IGDB finds them too heavy. */
  const readOn = async (chunk: number[], after: number, pageSize: number) => {
    for await (const page of filtered(chunk).cursorPages({ ...options, after, pageSize }))
      keep(page as Row[]);
  };

  const load = async (chunk: number[]): Promise<void> => {
    let first: Row[];
    try {
      first = (await filtered(chunk)
        .where("id > -1")
        .limit(rows)
        .with({ expectedRows: Math.min(rows, chunk.length * 4) })
        .execute(options)) as Row[];
    } catch (error) {
      if (!tooHeavy(error)) throw error;
      if (chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        await Promise.all([load(chunk.slice(0, middle)), load(chunk.slice(middle))]);
      } else {
        await readOn(chunk, -1, Math.max(1, Math.ceil(rows / 2)));
      }
      return;
    }
    keep(first);
    if (first.length < rows) return;
    if (chunk.length > 1) {
      // Too many rows for one page: split the ids so each part should fit in one.
      const total = await filtered(chunk).count().execute(options);
      const size = Math.max(1, Math.floor((rows * 0.8 * chunk.length) / Math.max(total, 1)));
      if (size < chunk.length) {
        const parts: number[][] = [];
        for (let i = 0; i < chunk.length; i += size) parts.push(chunk.slice(i, i + size));
        await Promise.all(parts.map(load));
        return;
      }
    }
    await readOn(chunk, (first[first.length - 1] as Row).id, rows);
  };
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  await Promise.all(chunks.map(load));

  for (const row of [...found.values()].sort((a, b) => a.id - b.id)) {
    // A copy without the link: an identical call in flight shares these rows and still needs it.
    let shown = row;
    if (!selectsLink) {
      shown = { ...row };
      delete shown[link];
    }
    for (const game of linkedGames(row[link])) result.get(game)?.push(shown as R);
  }
  for (const [id, group] of result) {
    if (sort) group.sort(compareBy(sort.field, sort.direction));
    if (limit !== undefined && group.length > limit) result.set(id, group.slice(0, limit));
  }
  return result;
}

/** The game ids in a link value: an id, an array of ids, or expanded objects (`games.name` selected). */
function linkedGames(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map((v) => (typeof v === "object" && v !== null ? (v as { id: number }).id : (v as number)));
}

/** Stable order on one scalar field; rows without the field go last, as in IGDB. */
function compareBy(field: string, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  return (a: unknown, b: unknown): number => {
    const x = (a as Record<string, unknown>)[field] as string | number | boolean | undefined;
    const y = (b as Record<string, unknown>)[field] as string | number | boolean | undefined;
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (x < y ? -1 : 1) * sign;
  };
}
