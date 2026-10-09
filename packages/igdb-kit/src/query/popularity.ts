import { QueryError } from "../core/errors";
import type { EndpointName } from "../generated/schema";
import type { ExecuteOptions, Query } from "./query";

/** IGDB's maximum `limit`: rows are read this many at a time. */
const PAGE = 500;
/**
 * When the first page of rows (the first round, for `weightedPopular()`) does not settle the ranking
 * and the `where` matches at most this many games, `popular()` and `weightedPopular()` read the rows
 * of those games instead of scanning on: exact, in a few requests.
 */
export const FEW_GAMES = 10_000;

/** Weight of each PopScore type, by id: `{ [PopularityType.IGDBWantToPlay]: 0.6, [PopularityType.IGDBPlaying]: 0.4 }`. */
export type PopularityWeights = Readonly<Partial<Record<number, number>>>;

export interface WeightedPopularOptions extends ExecuteOptions {
  /**
   * @deprecated Use the query's `limit()`, with `offset()` for the next pages:
   * `igdb.games.limit(20).weightedPopular(weights)`. Number of games to return, 0 to 500.
   */
  limit?: number;
  /**
   * Stop after reading this many rows of each type, even if the ranking is not settled. Defaults to
   * 5000. Does not apply when the first round does not settle the ranking and the `where` matches at
   * most 10,000 games: their own rows are read instead.
   */
  maxRows?: number;
}

export interface WeightedPopular<R> {
  game: R;
  /**
   * Sum of `weight × value / top value of the type`: each type is scaled to 0..1 before weighting,
   * since their values differ by orders of magnitude (IGDB visits top at 0.005, Steam peak players at 0.19).
   */
  score: number;
  /**
   * The raw value of each weighted type. `null` when IGDB has no row for the game in that type (a
   * game not on Steam, or too obscure to be tracked), which scores 0 but is not a measured 0.
   */
  values: Record<number, number | null>;
}

/** One row of `popularitySnapshot()`, ready to store: a day's snapshots make a history IGDB does not keep. */
export interface PopularitySnapshotRow {
  game_id: number;
  popularity_type: number;
  value: number;
  /** 1 for the most popular game of this type; equal values share a rank. */
  rank: number;
  /**
   * When IGDB computed the value, in Unix seconds: with `game_id` and `popularity_type`, the key of a
   * history. Each type is refreshed on its own schedule, so types in one snapshot can differ by days.
   */
  calculated_at: number | null;
  /** Where the metric comes from (`ExternalGameSource`): 121 IGDB, 1 Steam, 14 Twitch. */
  external_popularity_source: number | null;
}

export interface PopularitySnapshotOptions extends ExecuteOptions {
  /** PopScore types to read: `PopularityType` ids, one or several. Default: every type. */
  types?: number | readonly number[] | undefined;
  /**
   * Rows per type: only the `limit` most popular rows of each type, read in value order. Default:
   * every row.
   */
  limit?: number | undefined;
  /** @deprecated Use `limit`, which is also per type. */
  top?: number | undefined;
}

/** @internal The rows popularity helpers read. */
export interface PopularityRow {
  id: number;
  game_id?: number;
  popularity_type?: number;
  value?: number;
  calculated_at?: number;
  external_popularity_source?: number;
}

/** @internal The games a query matches, with only their id, in id order, 500 at a time. */
export function gameIds(games: Query<EndpointName, unknown>): Query<EndpointName, { id: number }> {
  return games.with({
    fields: ["id"],
    exclude: undefined,
    sort: { field: "id", direction: "asc" },
    offset: undefined,
    limit: PAGE,
  }) as Query<EndpointName, unknown> as Query<EndpointName, { id: number }>;
}

/** @internal How many games match, and the first page of their ids. */
export interface Matches {
  total: number;
  first: number[];
}

/** @internal Counts the games of `gameIds()` and lists the first page, sent together. */
export async function firstIds(
  ids: Query<EndpointName, { id: number }>,
  execute: ExecuteOptions,
): Promise<Matches> {
  const [total, first] = await Promise.all([ids.count().execute(execute), ids.execute(execute)]);
  return { total, first: first.map((row) => row.id) };
}

/** @internal Every id of `gameIds()`: the first page, then the others, all at once. */
export async function allIds(
  ids: Query<EndpointName, { id: number }>,
  matches: Matches,
  execute: ExecuteOptions,
): Promise<number[]> {
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(matches.total / PAGE) - 1) }, (_, i) =>
      ids.offset((i + 1) * PAGE).execute(execute),
    ),
  );
  return [...matches.first, ...rest.flat().map((row) => row.id)];
}

/** Splits ids into lists of `size`. */
export function chunk(ids: readonly number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/**
 * @internal Ranks games by a weighted sum of several PopScore types. Each positively weighted type is
 * read in value order, 500 rows per round; the other types of every new game are then looked up, so
 * scores are exact. It stops once the `limit`th game outscores any game not read yet (whose score is
 * at most the sum of each type's last value read), when the rows run out, or after `maxRows` per type.
 * With `matching`, the games of the caller's `where` are counted during the first round: if it does
 * not settle the ranking and they are at most `FEW_GAMES`, their own rows are read and ranked instead.
 */
export async function weightedPopular<R>(
  /** `popularity_primitives` with the row fields selected and sorted by value, descending. */
  primitives: Query<EndpointName, PopularityRow>,
  /** The games these ids name that pass the caller's filter, with its selected fields. */
  findGames: (ids: number[], options: ExecuteOptions) => Promise<R[]>,
  weights: PopularityWeights,
  options: WeightedPopularOptions,
  /** The games the caller's `where` matches (`gameIds()`); `undefined` without a `where`. */
  matching?: Query<EndpointName, { id: number }>,
): Promise<WeightedPopular<R>[]> {
  // The games to rank: the query's offset and limit, which the caller checked.
  const { limit = 10, maxRows = 5000, ...execute } = options;
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new QueryError(`maxRows must be a positive integer`);
  const weightOf = new Map<number, number>();
  for (const [key, weight] of Object.entries(weights)) {
    const type = Number(key);
    if (!Number.isSafeInteger(type) || type < 0) throw new QueryError(`Invalid popularity type: ${key}`);
    if (weight === undefined || weight === 0) continue;
    if (!Number.isFinite(weight)) throw new QueryError(`Weight of type ${key} must be a finite number`);
    weightOf.set(type, weight);
  }
  const types = [...weightOf.keys()];
  // A negative weight can only lower a score: only positive types can bring a game to the top.
  const scanned = types.filter((type) => (weightOf.get(type) as number) > 0);
  if (scanned.length === 0) throw new QueryError("weightedPopular() needs at least one positive weight");

  const page = (type: number, offset: number, size: number) =>
    primitives.where(`popularity_type = ${type}`).limit(size).offset(offset).execute(execute);
  const typeList = types.join(",");
  // Each game has at most one row per type, so this many games fit in one page of rows.
  const lookupSize = Math.max(1, Math.floor(PAGE / types.length));
  /** The rows of these games in every weighted type, by game and type. */
  const lookup = async (ids: readonly number[]) => {
    const pages = await Promise.all(
      chunk(ids, lookupSize).map(async (ids) => {
        const rows: PopularityRow[] = [];
        const query = primitives.where(`game_id = (${ids.join(",")}) & popularity_type = (${typeList})`);
        for await (const row of query.iterate({ ...execute, pageSize: PAGE })) rows.push(row);
        return rows;
      }),
    );
    const values = new Map<number, Map<number, number>>();
    for (const row of pages.flat()) {
      if (row.game_id === undefined || row.popularity_type === undefined || row.value === undefined) continue;
      const byType = values.get(row.game_id) ?? new Map<number, number>();
      if (!byType.has(row.popularity_type)) byType.set(row.popularity_type, row.value);
      values.set(row.game_id, byType);
    }
    return values;
  };
  /** Top value of each type, which scales it to 0..1. */
  const top = new Map<number, number>();
  const scored = (game: R, byType: Map<number, number> | undefined): WeightedPopular<R> => {
    const record: Record<number, number | null> = {};
    let score = 0;
    for (const type of types) {
      const value = byType?.get(type);
      record[type] = value ?? null;
      const max = top.get(type) ?? 0;
      if (value !== undefined && max > 0) score += ((weightOf.get(type) as number) * value) / max;
    }
    return { game, score, values: record };
  };
  const idOf = (game: R) => (game as { id: number }).id;
  const byScore = (a: WeightedPopular<R>, b: WeightedPopular<R>) =>
    b.score - a.score || idOf(a.game) - idOf(b.game);

  const unscanned = types.filter((type) => !scanned.includes(type));
  const offsets = new Map(scanned.map((type) => [type, 0]));
  /** Last value read per type still being read: no unread game has more there. */
  const threshold = new Map<number, number>();
  const ended = new Set<number>();
  const seen = new Set<number>();
  const results: WeightedPopular<R>[] = [];

  for (let round = 0; offsets.size > 0; round++) {
    const reads = [...offsets.entries()];
    // The top of each other type, and the count and first ids of the matches, go with the first round.
    const [pages, firsts, matches] = await Promise.all([
      Promise.all(reads.map(([type, offset]) => page(type, offset, PAGE))),
      round === 0 ? Promise.all(unscanned.map((type) => page(type, 0, 1))) : [],
      round === 0 && matching !== undefined ? firstIds(matching, execute) : undefined,
    ]);
    if (matches?.total === 0) return [];
    if (round === 0) for (const [i, type] of unscanned.entries()) top.set(type, firsts[i]?.[0]?.value ?? 0);
    const fresh: number[] = [];
    reads.forEach(([type, offset], i) => {
      const rows = pages[i] as PopularityRow[];
      if (offset === 0) top.set(type, rows[0]?.value ?? 0);
      for (const row of rows) {
        if (row.game_id !== undefined && !seen.has(row.game_id)) {
          seen.add(row.game_id);
          fresh.push(row.game_id);
        }
      }
      const end = rows.length < PAGE;
      if (end) ended.add(type);
      threshold.set(type, end ? 0 : (rows[rows.length - 1]?.value ?? 0));
      if (end || offset + PAGE >= maxRows) offsets.delete(type);
      else offsets.set(type, offset + PAGE);
    });

    const [values, games] = await Promise.all([
      lookup(fresh),
      fresh.length > 0 ? findGames(fresh, execute) : [],
    ]);
    for (const game of games) results.push(scored(game, values.get(idOf(game))));
    results.sort(byScore);

    let bound = 0;
    for (const type of scanned) {
      const max = top.get(type) ?? 0;
      if (max > 0) bound += ((weightOf.get(type) as number) * (threshold.get(type) ?? 0)) / max;
    }
    const last = results[limit - 1];
    if (last !== undefined && last.score >= bound) break;
    if (
      matching !== undefined &&
      matches !== undefined &&
      matches.total <= FEW_GAMES &&
      ended.size < scanned.length
    ) {
      // Few games match: score the ones not read yet from their own rows, then read the winners.
      const known = new Map(results.map((entry) => [idOf(entry.game), entry]));
      const candidates = await allIds(matching, matches, execute);
      const others = await lookup(candidates.filter((id) => !known.has(id)));
      const ranked = [
        ...known.values(),
        // Like the scan, only games with a row in a positively weighted type can be ranked.
        ...[...others]
          .filter(([, byType]) => scanned.some((type) => byType.has(type)))
          .map(([id, byType]) => scored({ id } as R, byType)),
      ]
        .sort(byScore)
        .slice(0, limit);
      const missing = ranked.flatMap((entry) => (known.has(idOf(entry.game)) ? [] : [idOf(entry.game)]));
      const found = new Map(
        (missing.length > 0 ? await findGames(missing, execute) : []).map((game) => [idOf(game), game]),
      );
      return ranked.flatMap((entry) => {
        if (known.has(idOf(entry.game))) return [entry];
        const game = found.get(idOf(entry.game));
        return game === undefined ? [] : [{ ...entry, game }];
      });
    }
  }
  return results.slice(0, limit);
}

/**
 * @internal Reads PopScore rows to store, one array per type, ranked. With `limit`, each type is read
 * in value order with offsets (`ceil(limit / 500)` requests per type), all types at once. Otherwise the
 * types are counted together, then every row is read in id order with offsets (IGDB updates values
 * in place, so ids stay put): each type's pages are requested at once, two types at a time so that
 * the next one queues behind the current one. Three types are held at most.
 */
export async function* popularitySnapshot(
  /** `popularity_primitives` with the row fields selected. */
  primitives: Query<EndpointName, PopularityRow>,
  types: readonly number[],
  options: PopularitySnapshotOptions,
): AsyncGenerator<PopularitySnapshotRow[], void, undefined> {
  const { types: _, top, limit = top, ...rest } = options;
  const execute: ExecuteOptions = { ...rest, priority: rest.priority ?? "background" };
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new QueryError(`limit must be a positive integer, got ${limit}`);
  }
  for (const type of types) {
    if (!Number.isSafeInteger(type) || type < 0) throw new QueryError(`Invalid popularity type: ${type}`);
  }
  const unique = [...new Set(types)];
  const ofType = (type: number) => primitives.where(`popularity_type = ${type}`);
  const counts =
    limit === undefined
      ? Promise.all(unique.map((type) => ofType(type).count().execute(execute)))
      : undefined;
  counts?.catch(() => {}); // awaited by the reads below
  const read = async (type: number, index: number): Promise<PopularityRow[]> => {
    const rows = limit ?? ((await counts) as number[])[index] ?? 0;
    const query =
      limit === undefined ? ofType(type).with({ sort: { field: "id", direction: "asc" } }) : ofType(type);
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(rows / PAGE) }, (_, i) =>
        query
          .limit(Math.min(PAGE, limit === undefined ? PAGE : limit - i * PAGE))
          .offset(i * PAGE)
          .execute(execute),
      ),
    );
    const all = pages.flat();
    // Rows added since the count come after the last id read.
    const last = all[all.length - 1];
    if (limit === undefined && last !== undefined && pages[pages.length - 1]?.length === PAGE) {
      for await (const row of query.where(`id > ${last.id}`).iterate({ ...execute, pageSize: PAGE }))
        all.push(row);
    }
    return all;
  };
  const start = (type: number, index: number) => {
    const rows = read(type, index);
    rows.catch(() => {}); // awaited in order below; avoid unhandled rejections meanwhile
    return rows;
  };
  // The top rows of each type are few: they are all requested at once.
  const ahead = limit === undefined ? 2 : unique.length;
  const queue = unique.slice(0, ahead).map((type, index) => start(type, index));
  for (const [index, type] of unique.entries()) {
    const rows = await (queue.shift() ?? start(type, index));
    const following = unique[index + ahead];
    if (following !== undefined) queue.push(start(following, index + ahead));
    const snapshot = rankRows(rows);
    if (snapshot.length > 0) yield snapshot;
  }
}

/** @internal Sorts one type's rows by value and ranks them, skipping rows without a game or a value. */
export function rankRows(rows: readonly PopularityRow[]): PopularitySnapshotRow[] {
  const seen = new Set<string>();
  const valid: PopularitySnapshotRow[] = [];
  for (const row of rows) {
    if (row.game_id === undefined || row.popularity_type === undefined || row.value === undefined) continue;
    const key = `${row.game_id}:${row.popularity_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({
      game_id: row.game_id,
      popularity_type: row.popularity_type,
      value: row.value,
      rank: 0,
      calculated_at: row.calculated_at ?? null,
      external_popularity_source: row.external_popularity_source ?? null,
    });
  }
  valid.sort((a, b) => b.value - a.value || a.game_id - b.game_id);
  valid.forEach((row, i) => {
    const previous = valid[i - 1];
    row.rank = previous !== undefined && previous.value === row.value ? previous.rank : i + 1;
  });
  return valid;
}
