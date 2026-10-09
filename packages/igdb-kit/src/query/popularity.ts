import { QueryError } from "../core/errors";
import type { EndpointName } from "../generated/schema";
import type { ExecuteOptions, Query } from "./query";

/** IGDB's maximum `limit`: rows are read this many at a time. */
const PAGE = 500;

/** Weight of each PopScore type, by id: `{ [PopularityType.IGDBWantToPlay]: 0.6, [PopularityType.IGDBPlaying]: 0.4 }`. */
export type PopularityWeights = Readonly<Partial<Record<number, number>>>;

export interface WeightedPopularOptions extends ExecuteOptions {
  /** Number of games to return, 1 to 500. Defaults to 10. */
  limit?: number;
  /** Stop after reading this many rows of each type, even if the ranking is not settled. Defaults to 5000. */
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
  /** PopScore types to read. Defaults to every `PopularityType`. */
  types?: readonly number[] | undefined;
  /** Only the `top` most popular rows of each type, read in value order. Defaults to every row. */
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

/**
 * @internal Ranks games by a weighted sum of several PopScore types. Each positively weighted type is
 * read in value order, 500 rows per round; the other types of every new game are then looked up, so
 * scores are exact. It stops once the `limit`th game outscores any game not read yet (whose score is
 * at most the sum of each type's last value read), when the rows run out, or after `maxRows` per type.
 */
export async function weightedPopular<R>(
  /** `popularity_primitives` with the row fields selected and sorted by value, descending. */
  primitives: Query<EndpointName, PopularityRow>,
  /** The games these ids name that pass the caller's filter, with its selected fields. */
  findGames: (ids: number[], options: ExecuteOptions) => Promise<R[]>,
  weights: PopularityWeights,
  options: WeightedPopularOptions,
): Promise<WeightedPopular<R>[]> {
  const { limit = 10, maxRows = 5000, ...execute } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE) {
    throw new QueryError(`limit must be an integer between 1 and ${PAGE}, got ${limit}`);
  }
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
  /** Top value of each type, which scales it to 0..1. */
  const top = new Map<number, number>();
  const unscanned = types.filter((type) => !scanned.includes(type));
  const firsts = await Promise.all(unscanned.map((type) => page(type, 0, 1)));
  for (const [i, type] of unscanned.entries()) top.set(type, firsts[i]?.[0]?.value ?? 0);

  const offsets = new Map(scanned.map((type) => [type, 0]));
  /** Last value read per type still being read: no unread game has more there. */
  const threshold = new Map<number, number>();
  const seen = new Set<number>();
  const results: WeightedPopular<R>[] = [];
  const typeList = types.join(",");
  // Each game has at most one row per type, so this many games fit in one page of rows.
  const lookupSize = Math.max(1, Math.floor(PAGE / types.length));

  while (offsets.size > 0) {
    const round = [...offsets.entries()];
    const pages = await Promise.all(round.map(([type, offset]) => page(type, offset, PAGE)));
    const fresh: number[] = [];
    round.forEach(([type, offset], i) => {
      const rows = pages[i] as PopularityRow[];
      if (offset === 0) top.set(type, rows[0]?.value ?? 0);
      for (const row of rows) {
        if (row.game_id !== undefined && !seen.has(row.game_id)) {
          seen.add(row.game_id);
          fresh.push(row.game_id);
        }
      }
      const end = rows.length < PAGE;
      threshold.set(type, end ? 0 : (rows[rows.length - 1]?.value ?? 0));
      if (end || offset + PAGE >= maxRows) offsets.delete(type);
      else offsets.set(type, offset + PAGE);
    });

    const chunks: number[][] = [];
    for (let i = 0; i < fresh.length; i += lookupSize) chunks.push(fresh.slice(i, i + lookupSize));
    const [lookups, games] = await Promise.all([
      Promise.all(
        chunks.map(async (chunk) => {
          const rows: PopularityRow[] = [];
          const query = primitives.where(`game_id = (${chunk.join(",")}) & popularity_type = (${typeList})`);
          for await (const row of query.iterate({ ...execute, pageSize: PAGE })) rows.push(row);
          return rows;
        }),
      ),
      fresh.length > 0 ? findGames(fresh, execute) : [],
    ]);
    const values = new Map<number, Map<number, number>>();
    for (const row of lookups.flat()) {
      if (row.game_id === undefined || row.popularity_type === undefined || row.value === undefined) continue;
      const byType = values.get(row.game_id) ?? new Map<number, number>();
      if (!byType.has(row.popularity_type)) byType.set(row.popularity_type, row.value);
      values.set(row.game_id, byType);
    }
    for (const game of games) {
      const byType = values.get((game as { id: number }).id);
      const record: Record<number, number | null> = {};
      let score = 0;
      for (const type of types) {
        const value = byType?.get(type);
        record[type] = value ?? null;
        const max = top.get(type) ?? 0;
        if (value !== undefined && max > 0) score += ((weightOf.get(type) as number) * value) / max;
      }
      results.push({ game, score, values: record });
    }
    results.sort(
      (a, b) => b.score - a.score || (a.game as { id: number }).id - (b.game as { id: number }).id,
    );

    let bound = 0;
    for (const type of scanned) {
      const max = top.get(type) ?? 0;
      if (max > 0) bound += ((weightOf.get(type) as number) * (threshold.get(type) ?? 0)) / max;
    }
    const last = results[limit - 1];
    if (last !== undefined && last.score >= bound) break;
  }
  return results.slice(0, limit);
}

/**
 * @internal Reads PopScore rows to store, one array per type, ranked. With `top`, each type is read
 * in value order with offsets (`ceil(top / 500)` requests per type); otherwise with an id cursor per
 * type, all types at once, which automatic batching packs into multiqueries.
 */
export async function* popularitySnapshot(
  /** `popularity_primitives` with the row fields selected. */
  primitives: Query<EndpointName, PopularityRow>,
  types: readonly number[],
  options: PopularitySnapshotOptions,
): AsyncGenerator<PopularitySnapshotRow[], void, undefined> {
  const { types: _, top, ...rest } = options;
  const execute: ExecuteOptions = { ...rest, priority: rest.priority ?? "background" };
  if (top !== undefined && (!Number.isInteger(top) || top < 1)) {
    throw new QueryError(`top must be a positive integer, got ${top}`);
  }
  for (const type of types) {
    if (!Number.isSafeInteger(type) || type < 0) throw new QueryError(`Invalid popularity type: ${type}`);
  }
  const read = async (type: number): Promise<PopularityRow[]> => {
    const query = primitives.where(`popularity_type = ${type}`);
    if (top === undefined) {
      const rows: PopularityRow[] = [];
      for await (const row of query.iterate({ ...execute, pageSize: PAGE })) rows.push(row);
      return rows;
    }
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(top / PAGE) }, (_, i) =>
        query
          .limit(Math.min(PAGE, top - i * PAGE))
          .offset(i * PAGE)
          .execute(execute),
      ),
    );
    return pages.flat();
  };
  const pending = [...new Set(types)].map((type) => {
    const rows = read(type);
    rows.catch(() => {}); // awaited in order below; avoid unhandled rejections meanwhile
    return rows;
  });
  for (const rows of pending) {
    const snapshot = rankRows(await rows);
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
