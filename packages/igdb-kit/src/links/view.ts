import { QueryError } from "../core/errors";
import { entities, type Game } from "../generated/schema";
import type { ExecuteOptions, Query } from "../query/query";
import type { Prettify, ScalarKeys } from "../query/types";
import type { Condition, WhereRoot } from "../query/where";
import { findByGames, gameLink } from "./by-game";

// biome-ignore lint/suspicious/noExplicitAny: the rows of each linked query are typed by ViewRow.
type AnyQuery = Query<any, any>;

/** Queries on endpoints that point to games, by the name their rows get in each view result. */
export type ViewLinks = Record<string, AnyQuery>;

/** Keeps `with` keys off game fields, so a linked list never hides a selected field. */
export type NoGameFields = { [K in keyof Game]?: never };

/** One result of a view: the game with each linked query's rows under its key. */
export type ViewRow<R, W extends ViewLinks> = Prettify<
  R & { [K in keyof W]: W[K] extends PromiseLike<readonly (infer L)[]> ? L[] : never }
>;

/**
 * Games with data from other endpoints attached, from `igdb.defineView()`. `findById()` and
 * `findByIds()` send the games and every linked query together, so batching packs them into as few
 * multiqueries as possible (one for a single game). A list (`where`, `search`, `sort`, `limit`, then
 * await) needs the game ids first, so it takes two rounds: the games, then the linked rows of all of
 * them at once; a `search` is always sent alone, as IGDB requires.
 */
export class View<R, W extends ViewLinks> implements PromiseLike<ViewRow<R, W>[]> {
  /** @internal */
  constructor(
    private readonly base: Query<"games", R>,
    private readonly links: W,
  ) {
    for (const [key, link] of Object.entries(links)) {
      if (key in (entities.Game ?? {})) {
        throw new QueryError(`View key "${key}" is a field of games: pick another name`);
      }
      if (gameLink(link.endpoint) === undefined) {
        throw new QueryError(`View key "${key}": ${link.endpoint} does not point to games`);
      }
      if (link.state.search !== undefined || link.state.offset !== undefined) {
        throw new QueryError(`View key "${key}": a linked query cannot use search or offset`);
      }
    }
  }

  /** Filters the games, as `Query.where`, named filters (`developedBy()`…) included. */
  where(condition: string | ((fields: WhereRoot<"games">) => Condition)): View<R, W> {
    return new View(this.base.where(condition), this.links);
  }

  /** Sorts the games, as `Query.sort`. */
  sort(field: ScalarKeys<Game>, direction: "asc" | "desc" = "asc"): View<R, W> {
    return new View(this.base.sort(field, direction), this.links);
  }

  /** Searches the games (sent alone, before the linked queries), as `Query.search`. */
  search(term: string): View<R, W> {
    return new View(this.base.search(term), this.links);
  }

  /** Number of games, 0 to 500. IGDB defaults to 10. */
  limit(count: number): View<R, W> {
    return new View(this.base.limit(count), this.links);
  }

  offset(count: number): View<R, W> {
    return new View(this.base.offset(count), this.links);
  }

  /** Caches the games query, as `Query.cache`. Linked queries keep their own `cache()`. */
  cache(ttlMs: number | false): View<R, W> {
    return new View(this.base.cache(ttlMs), this.links);
  }

  /** The game with this id and its linked rows, or null. */
  async findById(id: number, options?: ExecuteOptions): Promise<ViewRow<R, W> | null> {
    return (await this.findByIds([id], options))[0] ?? null;
  }

  /** The games with these ids, in the order given (missing ids are skipped), with their linked rows. */
  async findByIds(ids: readonly number[], options?: ExecuteOptions): Promise<ViewRow<R, W>[]> {
    const batched = { ...options, batch: true };
    const [games, linked] = await Promise.all([this.base.findByIds(ids, batched), this.load(ids, batched)]);
    return this.attach(games, linked);
  }

  /** The first game and its linked rows, or null. */
  async first(options?: ExecuteOptions): Promise<ViewRow<R, W> | null> {
    return (await this.limit(1).execute(options))[0] ?? null;
  }

  async execute(options?: ExecuteOptions): Promise<ViewRow<R, W>[]> {
    const batched = { ...options, batch: true };
    const games = await this.base.execute(batched);
    const ids = games.map((game) => (game as { id: number }).id);
    return this.attach(games, await this.load(ids, batched));
  }

  // biome-ignore lint/suspicious/noThenProperty: views are awaitable like queries.
  then<A = ViewRow<R, W>[], B = never>(
    onfulfilled?: ((value: ViewRow<R, W>[]) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async load(ids: readonly number[], options: ExecuteOptions): Promise<Map<number, unknown[]>[]> {
    return Promise.all(Object.values(this.links).map((link) => findByGames<unknown>(link, ids, options)));
  }

  private attach(games: R[], linked: Map<number, unknown[]>[]): ViewRow<R, W>[] {
    const keys = Object.keys(this.links);
    return games.map((game) => {
      const row: Record<string, unknown> = { ...(game as Record<string, unknown>) };
      const id = (game as { id: number }).id;
      keys.forEach((key, i) => {
        row[key] = linked[i]?.get(id) ?? [];
      });
      return row as ViewRow<R, W>;
    });
  }
}
