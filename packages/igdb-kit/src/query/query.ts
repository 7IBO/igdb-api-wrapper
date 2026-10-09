import { NetworkError, NotFoundError, PayloadTooLargeError, QueryError } from "../core/errors";
import type { Priority } from "../core/limiter";
import {
  type EndpointName,
  type Endpoints,
  endpoints,
  entities,
  type SearchableEndpoint,
} from "../generated/schema";
import { findByGames, type GameLinkedEndpoint } from "../links/by-game";
import { type DateInput, dateSeconds } from "./dates";
import {
  allIds,
  chunk,
  FEW_GAMES,
  firstIds,
  gameIds,
  type PopularityRow,
  type PopularityWeights,
  type WeightedPopular,
  type WeightedPopularOptions,
  weightedPopular,
} from "./popularity";
import {
  RELEASE_FIELDS,
  type ReleaseCalendarEntry,
  type ReleaseRow,
  type ReleasesOptions,
  releaseCalendar,
} from "./releases";
import { Task } from "./task";
import type { ExcludePath, ExcludeResult, FieldPath, ScalarKeys, SelectResult } from "./types";
import { type Condition, type NameLookup, throwIfRemoved, type WhereRoot, whereProxy } from "./where";

/** IGDB rejects `limit` above 500 (with a 403). */
export const MAX_LIMIT = 500;
/** IGDB rejects request bodies above 32,000 bytes (413), although its message says 32KB. */
export const MAX_BODY_BYTES = 32_000;
/** Bytes of pages `sync()` requests or holds at once, at most, about. */
const SYNC_BYTES_IN_FLIGHT = 64_000_000;
/** Requests `sync()` sends together, at most: as many as one multiquery holds. */
const SYNC_WAVE = 10;

/**
 * @internal IGDB refused a page for its size: a response above 10 MB (413), or one it gave up
 * building after 29 s (504 "Endpoint request timed out"). The same rows pass in smaller pages.
 */
export function tooHeavy(error: unknown): boolean {
  return (
    error instanceof PayloadTooLargeError ||
    (error instanceof NetworkError && error.status === 504 && /timed out/i.test(error.message))
  );
}

export interface ExecuteOptions {
  signal?: AbortSignal | undefined;
  /** `background` requests wait behind `interactive` ones. Default `interactive`. */
  priority?: Priority | undefined;
  /**
   * Group this query with others sent at the same time into one multiquery. Default: the client's
   * `autoBatch` setting (on). `false` always sends it alone.
   */
  batch?: boolean | undefined;
}

/** What the transport needs to send a query, alone or as one block of a multiquery. */
export interface QueryRequest {
  endpoint: EndpointName;
  /** `games` for a list, `games/count` for a count. */
  path: string;
  body: string;
  kind: "list" | "count";
  /** IGDB returns an empty multiquery when any block uses `search`, so these are sent alone. */
  hasSearch: boolean;
  /** Selected fields, used to estimate the response size. */
  fields: readonly string[];
  /** Expected number of entities (the `limit`, 10 by default; 0 for a count). */
  limit: number;
  /** Most entities the response can hold: the `limit`, 10 by default (0 for a count). */
  maxRows?: number | undefined;
  /** How long to cache the response: set by `cache()`, else the client's `cacheTtlMs`. 0 disables. */
  cacheTtlMs?: number | undefined;
  /** Company names in `body` that the client turns into ids before sending (`developedBy("Nintendo")`). */
  lookups?: readonly NameLookup[] | undefined;
}

export interface RawResponse {
  data: unknown;
  /** The `x-count` header: total matches of the `where`, regardless of `limit`. */
  total?: number | undefined;
  /** Size of the response body, in bytes. */
  bytes?: number | undefined;
}

/** @internal Implemented by the client. */
export interface QueryRunner {
  run(request: QueryRequest, options?: ExecuteOptions): Promise<RawResponse>;
  /**
   * Rows of this selection in one of igdb-kit's own pages (500 at most, fewer once rows are heavy),
   * and what such a page should weigh, from the sizes learned so far.
   */
  pageSize?(endpoint: EndpointName, fields: readonly string[]): { rows: number; bytes: number };
}

/**
 * Request options that the methods returning a `Task` (`popular()`, `releases()`, `searchAll()`…)
 * also take among their own options, deprecated: pass them to the task's `execute()`.
 */
export interface DeprecatedExecuteOptions {
  /** @deprecated Pass it to `execute()`: `igdb.games.popular(type).execute({ signal })`. */
  signal?: AbortSignal | undefined;
  /** @deprecated Pass it to `execute()`: `igdb.games.popular(type).execute({ priority })`. */
  priority?: Priority | undefined;
  /** @deprecated Pass it to `execute()`, or put the task in `igdb.batch()`. */
  batch?: boolean | undefined;
}

export interface PopularOptions extends DeprecatedExecuteOptions {
  /**
   * @deprecated Use the query's `limit()`, with `offset()` for the next pages:
   * `igdb.games.limit(20).popular(type)`. Number of games to return, 0 to 500.
   */
  limit?: number;
  /**
   * Stop after reading this many popularity rows when a `where` filters most games out. Defaults to
   * 5000. Does not apply when the `where` matches at most 10,000 games: their own rows are read instead.
   */
  maxRows?: number;
}

/** @internal */
export interface QueryState {
  fields: readonly string[];
  exclude?: readonly string[] | undefined;
  where?: string | undefined;
  sort?: { field: string; direction: "asc" | "desc" } | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  cacheTtlMs?: number | undefined;
  /** Rows expected back, when it differs from `limit`; only used to estimate the response size. */
  expectedRows?: number | undefined;
  /** Company names of the `where`, resolved to ids when the query runs. */
  lookups?: readonly NameLookup[] | undefined;
}

export interface SyncOptions extends ExecuteOptions {
  /**
   * Pages requested or waiting to be read at once. Default 40, which automatic batching sends as a
   * few multiqueries; fewer when pages are heavy, so that about 64 MB of pages are held.
   */
  concurrency?: number | undefined;
  /** Up to this many matches, pages are read one after another with an id cursor. Default 0. */
  cursorThreshold?: number | undefined;
}

/** Base of everything that can be awaited or put in a `batch()`. */
export abstract class Executable<T> implements PromiseLike<T> {
  /** @internal */
  abstract toRequest(): QueryRequest;
  /** @internal */
  abstract parse(response: RawResponse): T;
  /** @internal */
  protected abstract readonly runner: QueryRunner;

  async execute(options?: ExecuteOptions): Promise<T> {
    return this.parse(await this.runner.run(this.toRequest(), options));
  }

  // biome-ignore lint/suspicious/noThenProperty: queries are awaitable on purpose.
  then<A = T, B = never>(
    onfulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  /** Runs the query, like `await`, and handles its error as `Promise.catch` does. */
  catch<B = never>(onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
    return this.execute().catch(onrejected);
  }

  /** Runs the query, like `await`, and calls `onfinally` once it settles, as `Promise.finally` does. */
  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.execute().finally(onfinally);
  }

  /**
   * The Apicalypse body this query sends. Company names (`developedBy("Nintendo")`) show as name
   * filters, which IGDB accepts; the client looks them up and sends their ids instead.
   */
  toApicalypse(): string {
    return this.toRequest().body;
  }
}

/** @internal Checks a field path against the schema; `scalarOnly` for `sort`. */
export function validatePath(entity: string, path: string, scalarOnly: boolean): void {
  const segments = path.split(".");
  let current = entity;
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "*" && last && !scalarOnly) return;
    const target = entities[current]?.[segment];
    if (target === undefined) {
      throwIfRemoved(current, segment, path);
      throw new QueryError(`Unknown field "${path}" on ${entity}: ${current} has no field "${segment}"`);
    }
    if (!last) {
      if (target === 0) throw new QueryError(`"${segments.slice(0, index + 1).join(".")}" is not a relation`);
      current = target;
    } else if (scalarOnly && target !== 0) {
      throw new QueryError(`Cannot sort on relation "${path}", pick one of its fields`);
    }
  });
}

/**
 * An immutable, typed query on one endpoint. `R` is the shape of each result, derived from `select`.
 * Await it directly to run it, or pass it to `batch()`.
 */
export class Query<N extends EndpointName, R = { id: number }> extends Executable<R[]> {
  /** @internal */
  constructor(
    protected readonly runner: QueryRunner,
    readonly endpoint: N,
    /** @internal */
    readonly state: QueryState = { fields: [] },
  ) {
    super();
  }

  private get entity(): string {
    return endpointEntity(this.endpoint);
  }

  /** @internal A copy with some of the state replaced, unvalidated, of the same class. */
  with(patch: Partial<QueryState>): this {
    const Class = this.constructor as new (runner: QueryRunner, endpoint: N, state: QueryState) => this;
    return new Class(this.runner, this.endpoint, { ...this.state, ...patch });
  }

  /** This query for a lookup by ids: an `offset` would skip the rows asked for, and `sort` is moot. */
  private byIds(): this {
    return this.with({ offset: undefined, sort: undefined });
  }

  /**
   * @internal Rows per page when igdb-kit pages through this selection itself: `max` (500), or fewer
   * so that a page stays near `maxBatchBytes` (4 MB) once rows are heavy. A game with its media,
   * companies, dates and websites expanded weighs about 20 KB.
   */
  pageRows(max: number = MAX_LIMIT): number {
    const size = this.runner.pageSize?.(this.endpoint, this.state.fields);
    return Math.max(1, Math.min(max, size?.rows ?? max));
  }

  /**
   * Fields to return, as paths: `"name"`, `"cover.image_id"`, `"platforms.*"`, `"*"`. Selecting a
   * sub-field of a relation expands it; otherwise a relation comes back as an id. Replaces any
   * previous selection.
   */
  select<P extends string>(
    ...fields: FieldPath<Endpoints[N], P>[]
  ): QueryOf<N, SelectResult<Endpoints[N], P>> {
    for (const field of fields) validatePath(this.entity, field, false);
    return this.with({ fields: [...new Set(fields as string[])], exclude: undefined }) as never;
  }

  /**
   * Leaves selected fields out of the response, at any depth: `select("*", "cover.*").exclude("summary",
   * "cover.url")`. Only fields the selection covers are accepted (IGDB rejects the others once a
   * relation is expanded); `id` is always returned, and an expanded relation is dropped from `select`
   * instead. Call it after `select`, which resets it.
   */
  exclude<P extends string>(...fields: ExcludePath<R, P>[]): QueryOf<N, ExcludeResult<R, P>> {
    for (const field of fields) this.validateExclude(field);
    return this.with({
      exclude: [...new Set([...(this.state.exclude ?? []), ...(fields as string[])])],
    }) as never;
  }

  private validateExclude(path: string): void {
    validatePath(this.entity, path, false);
    const segments = path.split(".");
    const parent = segments.slice(0, -1).join(".");
    const field = segments[segments.length - 1];
    if (field === "*") throw new QueryError(`IGDB does not allow "*" in exclude ("${path}")`);
    if (field === "id") throw new QueryError(`IGDB always returns "${path}": it cannot be excluded`);
    const { fields } = this.state;
    if (fields.some((f) => f.startsWith(`${path}.`))) {
      throw new QueryError(`"${path}" is expanded: remove its fields from select() instead of excluding it`);
    }
    const covered = fields.includes(path) || fields.includes(parent ? `${parent}.*` : "*");
    if (!covered) throw new QueryError(`Cannot exclude "${path}": it is not selected`);
  }

  /**
   * Filters with a typed builder (`g => g.rating.gte(80)`) or a raw Apicalypse condition. On `games`,
   * the builder also has named filters: `g.developedBy(908)`, `g.publishedBy(50)`, `g.releasedIn({...})`.
   */
  where(condition: string | ((fields: WhereRoot<N>) => Condition)): this {
    const built =
      typeof condition === "string" ? undefined : condition(whereProxy(this.entity) as WhereRoot<N>);
    const text = built === undefined ? (condition as string) : built.text;
    const where = this.state.where ? `(${this.state.where}) & (${text})` : text;
    const lookups = built?.lookups.length
      ? [...(this.state.lookups ?? []), ...built.lookups]
      : this.state.lookups;
    return this.with({ where, lookups });
  }

  /**
   * Sorts on one scalar field of this endpoint. IGDB supports a single sort field and silently
   * ignores unknown ones and fields of relations (`cover.width`), so those are rejected here.
   */
  sort(field: ScalarKeys<Endpoints[N]>, direction: "asc" | "desc" = "asc"): this {
    if (field.includes("."))
      throw new QueryError(`IGDB ignores sort on "${field}": sort on a field of ${this.endpoint} itself`);
    validatePath(this.entity, field, true);
    if (this.state.search)
      throw new QueryError("IGDB does not allow sort with search (results are by relevance)");
    return this.with({ sort: { field, direction } });
  }

  /** Full-text search, sorted by relevance. Only on searchable endpoints, and never with `sort`. */
  search(
    ...[term]: N extends SearchableEndpoint
      ? [term: string]
      : [notSearchable: "This endpoint does not support search"]
  ): this {
    if (!endpoints[this.endpoint].searchable)
      throw new QueryError(`${this.endpoint} does not support search`);
    if (this.state.sort)
      throw new QueryError("IGDB does not allow sort with search (results are by relevance)");
    return this.with({ search: term });
  }

  /** Number of results, 0 to 500. IGDB defaults to 10. */
  limit(count: number): this {
    if (!Number.isInteger(count) || count < 0 || count > MAX_LIMIT) {
      throw new QueryError(`limit must be an integer between 0 and ${MAX_LIMIT}, got ${count}`);
    }
    return this.with({ limit: count });
  }

  offset(count: number): this {
    if (!Number.isInteger(count) || count < 0) throw new QueryError(`offset must be a positive integer`);
    return this.with({ offset: count });
  }

  /**
   * Caches the response for `ttlMs` in the client's `cache` store (memory by default), or disables
   * caching for this query with `false`. Identical queries then skip IGDB and the rate limit.
   */
  cache(ttlMs: number | false): this {
    if (ttlMs !== false && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
      throw new QueryError(`cache() takes a positive duration in milliseconds or false, got ${ttlMs}`);
    }
    return this.with({ cacheTtlMs: ttlMs === false ? 0 : ttlMs });
  }

  /** The first result, or null. */
  first(): Single<R> {
    return new Single(this.runner, this.limit(1).toRequest());
  }

  /** The entity with this id, or null. The query's `offset` and `sort` do not apply. */
  findById(id: number): Single<R> {
    return this.byIds()
      .where(`id = ${toId(id)}`)
      .first();
  }

  /** The first result; throws `NotFoundError` when nothing matches. */
  firstOrThrow(): SingleOrThrow<R> {
    return new SingleOrThrow(this.runner, this.limit(1).toRequest(), `No ${this.endpoint} matched the query`);
  }

  /** The entity with this id; throws `NotFoundError` when it does not exist (or the `where` excludes it). */
  findByIdOrThrow(id: number): SingleOrThrow<R> {
    const query = this.byIds()
      .where(`id = ${toId(id)}`)
      .limit(1);
    return new SingleOrThrow(this.runner, query.toRequest(), `No ${this.endpoint} with id ${id}`);
  }

  /**
   * The entities with these ids, in the order given (missing ids are skipped). Splits them into
   * chunks of 500, fewer when the selected rows are heavy, which `batch` and automatic batching send
   * together; a chunk IGDB finds too heavy is split in two. The query's `offset` and `sort` do not
   * apply. Sends nothing before it is awaited.
   */
  findByIds(ids: readonly number[]): Task<R[]>;
  /** @deprecated Pass the options to `execute()`: `query.findByIds(ids).execute({ signal })`. */
  findByIds(ids: readonly number[], options: ExecuteOptions | undefined): Task<R[]>;
  findByIds(ids: readonly number[], options?: ExecuteOptions): Task<R[]> {
    return new Task((execute) => this.runFindByIds(ids, { ...options, ...execute }));
  }

  /** `findByIds()`, run. */
  private async runFindByIds(ids: readonly number[], options: ExecuteOptions): Promise<R[]> {
    const unique = [...new Set(ids.map(toId))];
    const query = this.byIds();
    const size = query.pageRows();
    const chunks: number[][] = [];
    for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size));
    const pages = await Promise.all(chunks.map((chunk) => query.readIds(chunk, options)));
    const byId = new Map<number, R>();
    for (const page of pages) for (const item of page) byId.set((item as { id: number }).id, item);
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as R] : []));
  }

  /** The rows with these ids, read in halves when IGDB finds the response too heavy. */
  private async readIds(ids: readonly number[], options: ExecuteOptions | undefined): Promise<R[]> {
    try {
      return await this.where(`id = (${ids.join(",")})`)
        .limit(ids.length)
        .execute(options);
    } catch (error) {
      if (ids.length === 1 || !tooHeavy(error)) throw error;
      const middle = Math.ceil(ids.length / 2);
      const halves = await Promise.all([
        this.readIds(ids.slice(0, middle), options),
        this.readIds(ids.slice(middle), options),
      ]);
      return halves.flat();
    }
  }

  /** Number of entities matching the `where` (and `search`). */
  count(): Count {
    return new Count(this.runner, this.toRequest("count"));
  }

  /**
   * The page and the total number of matches in one call (from the `x-count` header). The total is
   * approximate with `search`. Not batchable.
   */
  withCount(): WithCount<R> {
    return new WithCount(this.runner, this.toRequest());
  }

  /**
   * Iterates over every match with an id cursor (`where id > last; sort id asc`), `pageSize` (1 to
   * 500, default 500) at a time, fewer when the selected rows are heavy. Stable even if entities are
   * added meanwhile, and fast at any depth unlike `offset`.
   */
  async *iterate(options: ExecuteOptions & { pageSize?: number } = {}): AsyncGenerator<R, void, undefined> {
    const { pageSize = MAX_LIMIT } = options;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_LIMIT) {
      throw new QueryError(`pageSize must be an integer between 1 and ${MAX_LIMIT}, got ${pageSize}`);
    }
    for await (const page of this.cursorPages(options)) yield* page;
  }

  /**
   * Every match, page by page, to copy an endpoint into your own storage. Pass `since` (the time you
   * started the previous sync: a `Date`, an ISO string or Unix seconds, like IGDB's `updated_at`) to
   * get only what changed since then. The first page goes out with the
   * count, in one multiquery. The other pages are then requested in parallel, which automatic
   * batching packs into multiqueries: each asks for the matches after a row read already, skipping
   * those the pages in between hold (`offset`), so pages come back full wherever the ids lie. Each
   * page starts on the last row of the previous one: when matches change during the sync and a page
   * starts further, the rows in between are read again with an id cursor, so none is missed. At most
   * `concurrency` pages are requested or waiting at once, about 64 MB. Requests default to
   * `background` priority so they wait behind interactive ones. Pages arrive in id order.
   */
  async *sync(
    options: SyncOptions &
      ("updated_at" extends keyof Endpoints[N] ? { since?: DateInput } : { since?: never }) = {},
  ): AsyncGenerator<R[], void, undefined> {
    if (this.state.search) throw new QueryError("sync() cannot be combined with search");
    const { concurrency = 40, cursorThreshold = 0, since: _, ...execute } = options;
    const executeOptions: ExecuteOptions = { ...execute, priority: execute.priority ?? "background" };
    let query: Query<N, R> = this.with({
      fields: this.fieldsWithId(),
      sort: { field: "id", direction: "asc" },
      offset: undefined,
      limit: undefined,
    });
    if (options.since !== undefined) {
      if (!(entities[this.entity] && "updated_at" in (entities[this.entity] as object))) {
        throw new QueryError(`${this.endpoint} has no updated_at field: sync it without since`);
      }
      query = query.where(`updated_at >= ${dateSeconds(options.since, "since")}`);
    }

    // Pages are segments of the matches in id order. Each starts on the last row of the previous one
    // and asks for the rows after its anchor, the furthest row read when it is planned, skipping
    // those up to its start: offsets stay within the pages in flight.
    const segments: SyncSegment<R>[] = [];
    /** The last row of each page read. */
    const ends: SyncAnchor[] = [];
    let anchor: SyncAnchor = { id: -1, position: -1 };
    /** Matches to read: the count, or less once a page comes back short. */
    let total = Number.POSITIVE_INFINITY;
    /** Position the next segment starts at: the last row of the last one planned. */
    let next = 0;
    /** Up to `cursorThreshold` matches, the rows after the first page are read with an id cursor. */
    let planning = true;
    let cap = MAX_LIMIT;
    let used = 0;
    let window = 1;
    let wave = 1;
    let stopped = false;

    const plan = (start: number, size: number): SyncSegment<R> => {
      const segment = { anchor, start: Math.max(start, anchor.position + 1), size };
      segments.push(segment);
      // Pages of one row cannot share one.
      next = segment.start + size - (size > 1 ? 1 : 0);
      return segment;
    };
    /** Reads `segment`, in two halves when IGDB finds it too heavy. */
    const read = (segment: SyncSegment<R>) => {
      used++;
      // A half skips from the closest row read since, in case the skip made IGDB time out, and goes
      // alone, so that it fails alone.
      if (segment.split) {
        segment.anchor = ends.reduce(
          (best, end) => (end.position < segment.start && end.position > best.position ? end : best),
          segment.anchor,
        );
      }
      // Starts on the next microtask, once `segment.reading` is set; still in the same batch.
      const reading = Promise.resolve().then(async () => {
        try {
          const skip = segment.start - segment.anchor.position - 1;
          const page = query.where(`id > ${segment.anchor.id}`).limit(segment.size);
          const rows = await (skip > 0 ? page.offset(skip) : page).execute(
            segment.split ? { ...executeOptions, batch: false } : executeOptions,
          );
          segment.rows = rows;
          if (rows.length === 0) used--;
          if (rows.length > 0) {
            const end = {
              id: (rows[rows.length - 1] as { id: number }).id,
              position: segment.start + rows.length - 1,
            };
            ends.push(end);
            if (end.position > anchor.position) anchor = end;
          }
          // A short page holds the last matches.
          if (rows.length < segment.size) total = Math.min(total, segment.start + rows.length);
        } catch (error) {
          used--;
          if (segment.size > 1 && tooHeavy(error)) {
            // Halves of the same size, the second starting on the last row of the first as segments
            // do (two rows make two pages of one), unless it starts past the matches: the first one
            // then shows whether rows were added.
            const half = segment.size > 2 ? Math.ceil((segment.size + 1) / 2) : 1;
            cap = Math.min(cap, half);
            const start = segment.start + Math.max(1, half - 1);
            const size = segment.start + segment.size - start;
            if (start < total) {
              segments.splice(segments.indexOf(segment) + 1, 0, {
                anchor: segment.anchor,
                start,
                size,
                split: true,
              });
            }
            segment.size = half;
            segment.split = true;
          } else segment.failed = { error };
        } finally {
          segment.reading = undefined;
        }
        pump();
      });
      reading.catch(() => {}); // awaited when the segment comes first
      segment.reading = reading;
    };
    /**
     * Reads the halves of split segments, in order, then plans new segments, up to the window. Waits
     * until a wave of requests fits, so that they leave together, unless the reader waits on the
     * first segment (`now`): it then leaves with the next ones, a wave past the window at most.
     */
    const pump = (now = false) => {
      if (stopped || segments.some((segment) => segment.failed)) return;
      if (!now && window - used < wave) return;
      for (const segment of segments) {
        if (used >= (now ? window + wave : window)) break;
        if (!segment.rows && !segment.reading && segment.start < total) read(segment);
      }
      // Up to the position after the last match, so that a full last page means rows were added.
      while (planning && next < total && used < window) read(plan(next, query.pageRows(cap)));
    };

    try {
      // The count goes out with the first page, in one multiquery. That page also tells what a row
      // of this selection weighs, before the next pages are sized and packed.
      const first = plan(0, query.pageRows());
      read(first);
      const [count] = await Promise.all([query.count().execute(executeOptions), first.reading]);
      total = Math.min(total, count);
      planning = count > cursorThreshold;
      const pageBytes = this.runner.pageSize?.(query.endpoint, query.state.fields).bytes ?? 0;
      // Pages being read, or read and not yet yielded. A wave more is read on while the reader waits
      // (see pump), so the window takes 80% of the bytes allowed.
      window = Math.max(
        1,
        Math.min(concurrency, Math.floor((SYNC_BYTES_IN_FLIGHT * 0.8) / Math.max(pageBytes, 1))),
      );
      // Requests leave in groups, which automatic batching packs into multiqueries.
      wave = Math.min(SYNC_WAVE, Math.ceil(window / 4));

      let last = -1;
      let more = false;
      while (segments.length > 0) {
        const head = segments[0] as SyncSegment<R>;
        const rows = head.rows;
        if (rows) {
          segments.shift();
          if (rows.length > 0) used--;
          pump();
          const skipped = head.start > head.anchor.position + 1;
          // A full page may have more rows after it; so may an empty one that skipped rows, if
          // matches were deleted since its offset was planned.
          more = rows.length === head.size || (rows.length === 0 && skipped);
          const start = (rows[0] as { id: number } | undefined)?.id;
          // A page that skipped rows and starts past the last one yielded: matches changed since its
          // offset was planned, so the rows in between are read again.
          if (start !== undefined && start > last && skipped) {
            const gap = query.where(`id < ${start}`).cursorPages({ ...executeOptions, after: last });
            for await (const page of gap) {
              last = (page[page.length - 1] as { id: number }).id;
              yield page;
            }
          }
          const from = rows.findIndex((row) => (row as { id: number }).id > last);
          if (from >= 0) {
            last = (rows[rows.length - 1] as { id: number }).id;
            yield from === 0 ? rows : rows.slice(from);
          }
        } else if (head.failed) {
          throw head.failed.error;
        } else if (head.reading) {
          await head.reading;
        } else if (head.start >= total) {
          segments.shift(); // a half planned past the matches, before a short page showed where they end
        } else {
          pump(true);
          if (!head.reading) read(head); // the next segment in order is read even past the window
        }
      }
      // The last page was full, or empty while rows matched: read on after the last row yielded.
      if (more) yield* query.cursorPages({ ...executeOptions, after: last });
    } finally {
      stopped = true;
    }
  }

  private fieldsWithId(): readonly string[] {
    const { fields } = this.state;
    return fields.length && !fields.includes("id") && !fields.includes("*") ? [...fields, "id"] : fields;
  }

  /**
   * @internal Every match after the id `after` (default: all), page by page in id order, with an id
   * cursor. A page holds `pageSize` rows (default 500), fewer when rows are heavy; a page IGDB finds
   * too heavy is asked again at half the size, and later pages stay at most that size.
   */
  async *cursorPages(
    options: ExecuteOptions & { pageSize?: number | undefined; after?: number | undefined } = {},
  ): AsyncGenerator<R[], void, undefined> {
    if (this.state.search) throw new QueryError("iterate() cannot be combined with search");
    const { pageSize = MAX_LIMIT, after = -1, ...execute } = options;
    const base = this.with({
      fields: this.fieldsWithId(),
      sort: { field: "id", direction: "asc" },
      offset: undefined,
    });
    let last = after;
    let cap = pageSize;
    let size = base.pageRows(cap);
    for (;;) {
      let page: R[];
      try {
        page = await base.where(`id > ${last}`).limit(size).execute(execute);
      } catch (error) {
        if (size === 1 || !tooHeavy(error)) throw error;
        cap = Math.ceil(size / 2);
        size = cap;
        continue;
      }
      if (page.length > 0) yield page;
      if (page.length < size) return;
      last = (page[page.length - 1] as { id: number }).id;
      size = base.pageRows(cap);
    }
  }

  /** @internal */
  toRequest(kind: "list" | "count" = "list"): QueryRequest {
    const { fields, exclude, where, sort, search, limit, offset, cacheTtlMs, expectedRows, lookups } =
      this.state;
    const lines: string[] = [];
    if (kind === "list" && fields.length) lines.push(`fields ${fields.join(",")};`);
    // One line for every excluded field: IGDB rejects a second `exclude` line.
    if (kind === "list" && exclude?.length) lines.push(`exclude ${exclude.join(",")};`);
    if (search !== undefined) lines.push(`search ${JSON.stringify(search)};`);
    if (where) lines.push(`where ${where};`);
    if (kind === "list") {
      if (sort) lines.push(`sort ${sort.field} ${sort.direction};`);
      if (limit !== undefined) lines.push(`limit ${limit};`);
      if (offset !== undefined) lines.push(`offset ${offset};`);
    }
    const body = lines.join(" ");
    const bytes = new TextEncoder().encode(body).length;
    if (bytes > MAX_BODY_BYTES) {
      throw new QueryError(
        `Query body is ${bytes} bytes, above IGDB's limit of ${MAX_BODY_BYTES}: split long id lists (findByIds does it)`,
        { endpoint: this.endpoint },
      );
    }
    return {
      endpoint: this.endpoint,
      path: kind === "count" ? `${this.endpoint}/count` : this.endpoint,
      body,
      kind,
      hasSearch: search !== undefined,
      fields,
      limit: kind === "count" ? 0 : (expectedRows ?? limit ?? 10),
      maxRows: kind === "count" ? 0 : (limit ?? 10),
      cacheTtlMs,
      ...(lookups?.length ? { lookups } : {}),
    };
  }

  /** @internal */
  parse(response: RawResponse): R[] {
    return response.data as R[];
  }
}

/** The query on `games`: a `Query` with the methods that only work on games. */
export class GamesQuery<R = { id: number }> extends Query<"games", R> {
  /**
   * The games behind store ids, such as Steam app ids: `findByExternalIds(ExternalGameSource.Steam,
   * ["292030"])`. Returns a map from each found id to its game, with the selected fields; ids IGDB
   * does not know, or whose game this query's `where` excludes, are missing.
   */
  findByExternalIds(source: number, uids: readonly (string | number)[]): Task<Map<string, R>>;
  /** @deprecated Pass the options to `execute()`: `findByExternalIds(source, uids).execute({ signal })`. */
  findByExternalIds(
    source: number,
    uids: readonly (string | number)[],
    options: ExecuteOptions | undefined,
  ): Task<Map<string, R>>;
  findByExternalIds(
    source: number,
    uids: readonly (string | number)[],
    options?: ExecuteOptions,
  ): Task<Map<string, R>> {
    return new Task((execute) => this.runFindByExternalIds(source, uids, { ...options, ...execute }));
  }

  /** `findByExternalIds()`, run. */
  private async runFindByExternalIds(
    source: number,
    uids: readonly (string | number)[],
    options: ExecuteOptions,
  ): Promise<Map<string, R>> {
    const unique = [...new Set(uids.map(String))];
    // One uid can have several rows (per platform or edition), so ask for fewer uids than rows.
    const chunkSize = 100;
    const rows = new Query<EndpointName, { uid?: string; game?: number }>(this.runner, "external_games", {
      fields: ["uid", "game"],
    });
    const gameOf = new Map<string, number>();
    await Promise.all(
      Array.from({ length: Math.ceil(unique.length / chunkSize) }, async (_, i) => {
        const chunk = unique.slice(i * chunkSize, (i + 1) * chunkSize);
        const filter = rows.where(
          `external_game_source = ${toId(source)} & uid = (${chunk.map((uid) => JSON.stringify(uid)).join(",")})`,
        );
        for await (const row of filter.iterate({ ...options, pageSize: MAX_LIMIT })) {
          if (row.uid !== undefined && row.game !== undefined && !gameOf.has(row.uid))
            gameOf.set(row.uid, row.game);
        }
      }),
    );
    const games = await this.findByIds([...gameOf.values()]).execute(options);
    const byId = new Map(games.map((game) => [(game as { id: number }).id, game]));
    const result = new Map<string, R>();
    for (const uid of unique) {
      const game = byId.get(gameOf.get(uid) ?? -1);
      if (game !== undefined) result.set(uid, game);
    }
    return result;
  }

  /**
   * The most popular games for one PopScore metric (`PopularityType.IGDBPlaying`,
   * `PopularityType.Steam24hrPeakPlayers`…), most popular first, each with its score. The selected
   * fields and the `where` of this query apply to the games, and its `limit` (default 10) and
   * `offset` pick the page of the ranking; `sort` throws. Popularity rows are read 500 at a time until
   * enough games match, or `maxRows` rows were read. The games a `where` matches are counted along with
   * the first page: if it is not enough and they are at most 10,000, their own rows are read instead,
   * which is exact and takes a few requests.
   */
  popular(type: number, options: PopularOptions = {}): Task<{ game: R; value: number }[]> {
    return new Task((execute) => this.runPopular(type, { ...options, ...execute }));
  }

  /** `popular()`, run. */
  private async runPopular(type: number, options: PopularOptions): Promise<{ game: R; value: number }[]> {
    if (this.state.search) throw new QueryError("popular() cannot be combined with search");
    const { limit: deprecatedLimit, maxRows = 5000, ...execute } = options;
    const page = this.rankingPage("popular()", deprecatedLimit);
    if (page.limit === 0) return [];
    // The games before the page are ranked too.
    const limit = page.offset + page.limit;
    // Without a filter almost every row matches; a few spare rows cover deleted games.
    const pageSize = this.state.where ? MAX_LIMIT : Math.min(MAX_LIMIT, limit + 10);
    const rows = new Query<EndpointName, { game_id?: number; value?: number }>(
      this.runner,
      "popularity_primitives",
      {
        fields: ["game_id", "value"],
        where: `popularity_type = ${toId(type)}`,
        sort: { field: "value", direction: "desc" },
      },
    );
    const matching = this.state.where ? gameIds(this as never) : undefined;
    const results: { game: R; value: number }[] = [];
    const seen = new Set<number>();
    for (let offset = 0; offset < maxRows && results.length < limit; offset += pageSize) {
      // The count and first ids of the matches go with the first page.
      const [read, matches] = await Promise.all([
        rows.limit(pageSize).offset(offset).execute(execute),
        offset === 0 && matching !== undefined ? firstIds(matching, execute) : undefined,
      ]);
      if (matches?.total === 0) return [];
      const ranked: { id: number; value: number }[] = [];
      for (const row of read) {
        if (row.game_id === undefined || seen.has(row.game_id)) continue;
        seen.add(row.game_id);
        ranked.push({ id: row.game_id, value: row.value ?? 0 });
      }
      const games = await this.findByIds(ranked.map((row) => row.id)).execute(execute);
      const byId = new Map(games.map((game) => [(game as { id: number }).id, game]));
      for (const { id, value } of ranked) {
        const game = byId.get(id);
        if (game !== undefined && results.length < limit) results.push({ game, value });
      }
      if (read.length < pageSize) break;
      if (
        results.length < limit &&
        matching !== undefined &&
        matches !== undefined &&
        matches.total <= FEW_GAMES
      ) {
        const top = await this.popularAmong(
          rows,
          limit,
          results,
          await allIds(matching, matches, execute),
          execute,
        );
        return top.slice(page.offset);
      }
    }
    // Equal values in id order, as when the rows of few games are read.
    return results
      .sort((a, b) => b.value - a.value || (a.game as { id: number }).id - (b.game as { id: number }).id)
      .slice(page.offset);
  }

  /**
   * The page of games a ranking returns (`popular()`, `weightedPopular()`): the query's `limit`
   * (default 10) and `offset`, or the deprecated `limit` option. The ranking sets the order, so a
   * `sort` throws.
   */
  private rankingPage(
    method: string,
    deprecatedLimit: number | undefined,
  ): { limit: number; offset: number } {
    if (this.state.sort) throw new QueryError(`${method} returns games in popularity order: remove sort()`);
    const limit = deprecatedLimit ?? this.state.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_LIMIT) {
      throw new QueryError(`limit must be an integer between 0 and ${MAX_LIMIT}, got ${limit}`);
    }
    return { limit, offset: this.state.offset ?? 0 };
  }

  /**
   * The `limit` games among `candidates` with the most popular rows, ranked exactly: each game has one
   * row per type at most, so the top `limit` rows of each list of ids hold the top of all. `found`
   * holds games already read.
   */
  private async popularAmong(
    rows: Query<EndpointName, { game_id?: number; value?: number }>,
    limit: number,
    found: readonly { game: R; value: number }[],
    candidates: readonly number[],
    execute: ExecuteOptions,
  ): Promise<{ game: R; value: number }[]> {
    const pages = await Promise.all(
      chunk(candidates, MAX_LIMIT).map((ids) =>
        rows
          .where(`game_id = (${ids.join(",")})`)
          // One row per game: 500 ids have 500 rows at most.
          .limit(Math.min(limit, MAX_LIMIT))
          .execute(execute),
      ),
    );
    const best = new Map<number, number>();
    for (const row of pages.flat()) {
      if (row.game_id !== undefined && !best.has(row.game_id)) best.set(row.game_id, row.value ?? 0);
    }
    const ranked = [...best].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit);
    const games = new Map(found.map(({ game }) => [(game as { id: number }).id, game]));
    const read = await this.findByIds(ranked.flatMap(([id]) => (games.has(id) ? [] : [id]))).execute(execute);
    for (const game of read) games.set((game as { id: number }).id, game);
    return ranked.flatMap(([id, value]) => {
      const game = games.get(id);
      return game === undefined ? [] : [{ game, value }];
    });
  }

  /**
   * The most popular games by a weighted mix of PopScore types, such as `{ [PopularityType.IGDBWantToPlay]:
   * 0.6, [PopularityType.IGDBPlaying]: 0.4 }`. Each type is scaled by its top value before weighting;
   * a game without a row in a type scores 0 there and gets `null` in `values`. Negative weights lower
   * a score. The fields and `where` of this query apply to the games, and its `limit` (default 10)
   * and `offset` pick the page of the ranking; `sort` throws. Each round reads 500 rows per
   * positively weighted type, then the other types and the games of the new ids (about 2 multiqueries
   * per round); it stops once no unread game can enter the page. The games a `where` matches
   * are counted during the first round: if it does not settle the top and they are at most 10,000,
   * their own rows are scored instead.
   */
  weightedPopular(
    weights: PopularityWeights,
    options: WeightedPopularOptions = {},
  ): Task<WeightedPopular<R>[]> {
    return new Task((execute) => this.runWeightedPopular(weights, { ...options, ...execute }));
  }

  /** `weightedPopular()`, run. */
  private async runWeightedPopular(
    weights: PopularityWeights,
    options: WeightedPopularOptions,
  ): Promise<WeightedPopular<R>[]> {
    if (this.state.search) throw new QueryError("weightedPopular() cannot be combined with search");
    const page = this.rankingPage("weightedPopular()", options.limit);
    if (page.limit === 0) return [];
    const rows = new Query<EndpointName, PopularityRow>(this.runner, "popularity_primitives", {
      fields: ["game_id", "popularity_type", "value"],
      sort: { field: "value", direction: "desc" },
    });
    const ranked = await weightedPopular(
      rows,
      (ids, execute) => this.findByIds(ids).execute(execute),
      weights,
      // The games before the page are ranked too.
      { ...options, limit: page.offset + page.limit },
      this.state.where ? gameIds(this as never) : undefined,
    );
    return ranked.slice(page.offset);
  }

  /**
   * The release calendar of a window: one entry per game released in it, with its most precise
   * release and every release in the window (platforms, regions, statuses). Imprecise dates (`Q4
   * 2026`) are labeled by `precision` and included when their period overlaps the window. The fields
   * and `where` of this query apply to the games; its `limit` and `offset`, when set, page the entries,
   * and `sort` throws. Costs 1 + `ceil(dates / 500)` requests, batched, plus `ceil(games / 500)`.
   */
  releases(options: ReleasesOptions): Task<ReleaseCalendarEntry<R>[]> {
    return new Task((execute) => this.runReleases({ ...options, ...execute }));
  }

  /** `releases()`, run. */
  private async runReleases(options: ReleasesOptions): Promise<ReleaseCalendarEntry<R>[]> {
    if (this.state.search) throw new QueryError("releases() cannot be combined with search");
    if (this.state.sort) throw new QueryError("releases() returns games by release date: remove sort()");
    const dates = new Query<EndpointName, ReleaseRow>(this.runner, "release_dates", {
      fields: RELEASE_FIELDS,
      sort: { field: "id", direction: "asc" },
    });
    const entries = await releaseCalendar(
      dates,
      (ids, execute) => this.findByIds(ids).execute(execute),
      options,
    );
    const { limit, offset = 0 } = this.state;
    return limit === undefined ? entries.slice(offset) : entries.slice(offset, offset + limit);
  }
}

/**
 * A query on an endpoint whose rows point to games (`release_dates`, `websites`, `characters`,
 * `game_time_to_beats`…): a `Query` with `findByGames()`.
 */
export class GameLinkedQuery<N extends GameLinkedEndpoint, R = { id: number }> extends Query<N, R> {
  /**
   * The rows linked to each of these games, as a map from game id to rows: `game_time_to_beats`,
   * `release_dates`, `websites`… through their `game` (or `game_id`) field, and `characters`,
   * `events`, `collections`, `franchises` through their `games` array. The fields and `where` of this
   * query apply; `sort` and `limit` apply to each game's rows, and every row comes back, not just 10.
   *
   * Every requested id is in the map, with an empty array when nothing points to it (most games have
   * no time to beat). A row linked to several of the games is under each of them. Ids are split by
   * 500 and pages of 500 rows are read until the end, sent together so batching packs them.
   */
  findByGames(gameIds: readonly number[]): Task<Map<number, R[]>>;
  /** @deprecated Pass the options to `execute()`: `query.findByGames(ids).execute({ signal })`. */
  findByGames(gameIds: readonly number[], options: ExecuteOptions | undefined): Task<Map<number, R[]>>;
  findByGames(gameIds: readonly number[], options?: ExecuteOptions): Task<Map<number, R[]>> {
    return new Task((execute) => findByGames<R>(this as never, gameIds, { ...options, ...execute }));
  }

  /** @deprecated Renamed `findByGames()`, like `findById()` and `findByIds()`; same arguments. */
  byGame(gameIds: readonly number[], options?: ExecuteOptions): Task<Map<number, R[]>> {
    return new Task((execute) => findByGames<R>(this as never, gameIds, { ...options, ...execute }));
  }
}

/**
 * The query type of an endpoint: `GamesQuery` for `games`, `GameLinkedQuery` for the endpoints whose
 * rows point to games, `Query` for the others. Each has only the methods that work on its endpoint.
 */
export type QueryOf<N extends EndpointName, R = { id: number }> = N extends "games"
  ? GamesQuery<R>
  : N extends GameLinkedEndpoint
    ? GameLinkedQuery<N, R>
    : Query<N, R>;

/** Result of `first()` / `findById()`. */
export class Single<R> extends Executable<R | null> {
  /** @internal */
  constructor(
    protected readonly runner: QueryRunner,
    private readonly request: QueryRequest,
  ) {
    super();
  }
  toRequest(): QueryRequest {
    return this.request;
  }
  parse(response: RawResponse): R | null {
    return ((response.data as R[])[0] ?? null) as R | null;
  }
}

/** Result of `firstOrThrow()` / `findByIdOrThrow()`. */
export class SingleOrThrow<R> extends Executable<R> {
  /** @internal */
  constructor(
    protected readonly runner: QueryRunner,
    private readonly request: QueryRequest,
    private readonly notFound: string,
  ) {
    super();
  }
  toRequest(): QueryRequest {
    return this.request;
  }
  parse(response: RawResponse): R {
    const item = (response.data as R[])[0];
    if (item === undefined) {
      throw new NotFoundError(this.notFound, { endpoint: this.request.endpoint, query: this.request.body });
    }
    return item;
  }
}

/** Result of `count()`. */
export class Count extends Executable<number> {
  /** @internal */
  constructor(
    protected readonly runner: QueryRunner,
    private readonly request: QueryRequest,
  ) {
    super();
  }
  toRequest(): QueryRequest {
    return this.request;
  }
  parse(response: RawResponse): number {
    return (response.data as { count: number }).count;
  }
}

/** Result of `withCount()`. */
export class WithCount<R> extends Executable<{ data: R[]; total: number }> {
  /** @internal */
  constructor(
    protected readonly runner: QueryRunner,
    private readonly request: QueryRequest,
  ) {
    super();
  }
  toRequest(): QueryRequest {
    return this.request;
  }
  override async execute(options?: ExecuteOptions): Promise<{ data: R[]; total: number }> {
    // The total comes from a response header that multiquery does not carry: never batch.
    return this.parse(await this.runner.run(this.request, { ...options, batch: false }));
  }
  parse(response: RawResponse): { data: R[]; total: number } {
    const data = response.data as R[];
    return { data, total: response.total ?? data.length };
  }
}

/** A row `sync()` read, and its position among the matches in id order. */
interface SyncAnchor {
  id: number;
  position: number;
}

/** A page of `sync()`: `size` matches from position `start`, asked for as the rows after `anchor`. */
interface SyncSegment<R> {
  anchor: SyncAnchor;
  start: number;
  size: number;
  /** A half of a page IGDB found too heavy. */
  split?: boolean | undefined;
  /** The rows, once read. */
  rows?: R[] | undefined;
  /** The read in progress. */
  reading?: Promise<void> | undefined;
  failed?: { error: unknown } | undefined;
}

/** @internal */
export function toId(id: number): number {
  if (!Number.isSafeInteger(id) || id < 0) throw new QueryError(`Invalid id: ${id}`);
  return id;
}

/** @internal */
export function endpointEntity(endpoint: EndpointName): string {
  return endpoints[endpoint].entity;
}
