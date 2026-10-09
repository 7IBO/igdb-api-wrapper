import { QueryError } from "../core/errors";
import type { Priority } from "../core/limiter";
import {
  type EndpointName,
  type Endpoints,
  endpoints,
  entities,
  type SearchableEndpoint,
} from "../generated/schema";
import type { FieldPath, ScalarPath, SelectResult } from "./types";
import { type Condition, throwIfRemoved, type WhereFields, whereProxy } from "./where";

/** IGDB rejects `limit` above 500 (with a 403). */
export const MAX_LIMIT = 500;
/** IGDB rejects request bodies above 32 KB (413). */
export const MAX_BODY_BYTES = 32 * 1024;

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
  /** How long to cache the response: set by `cache()`, else the client's `cacheTtlMs`. 0 disables. */
  cacheTtlMs?: number | undefined;
}

export interface RawResponse {
  data: unknown;
  /** The `x-count` header: total matches of the `where`, regardless of `limit`. */
  total?: number | undefined;
  /** Size of the response body, in characters. */
  bytes?: number | undefined;
}

/** @internal Implemented by the client. */
export interface QueryRunner {
  run(request: QueryRequest, options?: ExecuteOptions): Promise<RawResponse>;
}

export interface PopularOptions extends ExecuteOptions {
  /** Number of games to return, 1 to 500. Defaults to 10. */
  limit?: number;
  /** Stop after reading this many popularity rows when a `where` filters most games out. Defaults to 5000. */
  maxRows?: number;
}

interface QueryState {
  fields: readonly string[];
  where?: string | undefined;
  sort?: { field: string; direction: "asc" | "desc" } | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  cacheTtlMs?: number | undefined;
}

export interface SyncOptions extends ExecuteOptions {
  /** Id ranges of 500 requested at once. Default 40, which automatic batching sends as a few multiqueries. */
  concurrency?: number | undefined;
  /** Up to this many matches, pages are read with an id cursor instead of id ranges. Default 5000. */
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

  /** The Apicalypse body this query sends. */
  toApicalypse(): string {
    return this.toRequest().body;
  }
}

function validatePath(entity: string, path: string, scalarOnly: boolean): void {
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
    private readonly state: QueryState = { fields: [] },
  ) {
    super();
  }

  private get entity(): string {
    return endpointEntity(this.endpoint);
  }

  private with(patch: Partial<QueryState>): this {
    return new Query(this.runner, this.endpoint, { ...this.state, ...patch }) as this;
  }

  /**
   * Fields to return, as paths: `"name"`, `"cover.image_id"`, `"platforms.*"`, `"*"`. Selecting a
   * sub-field of a relation expands it; otherwise a relation comes back as an id. Replaces any
   * previous selection.
   */
  select<P extends string>(...fields: FieldPath<Endpoints[N], P>[]): Query<N, SelectResult<Endpoints[N], P>> {
    for (const field of fields) validatePath(this.entity, field, false);
    return this.with({ fields: [...new Set(fields as string[])] }) as never;
  }

  /** Filters with a typed builder (`g => g.rating.gte(80)`) or a raw Apicalypse condition. */
  where(condition: string | ((fields: WhereFields<Endpoints[N]>) => Condition)): this {
    const text =
      typeof condition === "string"
        ? condition
        : condition(whereProxy(this.entity) as WhereFields<Endpoints[N]>).text;
    const where = this.state.where ? `(${this.state.where}) & (${text})` : text;
    return this.with({ where });
  }

  /** Sorts on one scalar field. IGDB supports a single sort field and silently ignores unknown ones. */
  sort<P extends string>(field: ScalarPath<Endpoints[N], P>, direction: "asc" | "desc" = "asc"): this {
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

  /** The entity with this id, or null. */
  findById(id: number): Single<R> {
    return this.where(`id = ${toId(id)}`).first();
  }

  /**
   * The entities with these ids, in the order given (missing ids are skipped). Splits into chunks of
   * 500, which `batch` and automatic batching send together.
   */
  async findByIds(ids: readonly number[], options?: ExecuteOptions): Promise<R[]> {
    const unique = [...new Set(ids.map(toId))];
    const chunks: number[][] = [];
    for (let i = 0; i < unique.length; i += MAX_LIMIT) chunks.push(unique.slice(i, i + MAX_LIMIT));
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.where(`id = (${chunk.join(",")})`)
          .limit(chunk.length)
          .execute(options),
      ),
    );
    const byId = new Map<number, R>();
    for (const page of pages) for (const item of page) byId.set((item as { id: number }).id, item);
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as R] : []));
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
   * The games behind store ids, such as Steam app ids: `findByExternalIds(ExternalGameSource.Steam,
   * ["292030"])`. Returns a map from each found id to its game, with the selected fields; ids IGDB
   * does not know, or whose game this query's `where` excludes, are missing. Only on `games`.
   */
  async findByExternalIds(
    ...[source, uids, options]: N extends "games"
      ? [source: number, uids: readonly (string | number)[], options?: ExecuteOptions]
      : [notGames: "findByExternalIds() is only on games"]
  ): Promise<Map<string, R>> {
    if (this.endpoint !== "games") throw new QueryError("findByExternalIds() is only on games");
    const unique = [...new Set((uids as readonly (string | number)[]).map(String))];
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
          `external_game_source = ${toId(source as number)} & uid = (${chunk.map((uid) => JSON.stringify(uid)).join(",")})`,
        );
        for await (const row of filter.iterate({ ...options, pageSize: MAX_LIMIT })) {
          if (row.uid !== undefined && row.game !== undefined && !gameOf.has(row.uid))
            gameOf.set(row.uid, row.game);
        }
      }),
    );
    const games = await this.with({ sort: undefined, offset: undefined }).findByIds(
      [...gameOf.values()],
      options,
    );
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
   * fields and the `where` of this query apply to the games: popularity rows are read 500 at a time
   * until `limit` games match, or `maxRows` rows were read. Only on `games`.
   */
  async popular(
    ...[type, options = {}]: N extends "games"
      ? [type: number, options?: PopularOptions]
      : [notGames: "popular() is only on games"]
  ): Promise<{ game: R; value: number }[]> {
    if (this.endpoint !== "games") throw new QueryError("popular() is only on games");
    if (this.state.search) throw new QueryError("popular() cannot be combined with search");
    const { limit = 10, maxRows = 5000, ...execute } = options;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new QueryError(`limit must be an integer between 1 and ${MAX_LIMIT}, got ${limit}`);
    }
    // Without a filter almost every row matches; a few spare rows cover deleted games.
    const pageSize = this.state.where ? MAX_LIMIT : Math.min(MAX_LIMIT, limit + 10);
    const rows = new Query<EndpointName, { game_id?: number; value?: number }>(
      this.runner,
      "popularity_primitives",
      {
        fields: ["game_id", "value"],
        where: `popularity_type = ${toId(type as number)}`,
        sort: { field: "value", direction: "desc" },
      },
    );
    const results: { game: R; value: number }[] = [];
    const seen = new Set<number>();
    for (let offset = 0; offset < maxRows && results.length < limit; offset += pageSize) {
      const page = await rows.limit(pageSize).offset(offset).execute(execute);
      const ranked: { id: number; value: number }[] = [];
      for (const row of page) {
        if (row.game_id === undefined || seen.has(row.game_id)) continue;
        seen.add(row.game_id);
        ranked.push({ id: row.game_id, value: row.value ?? 0 });
      }
      const games = await this.with({ sort: undefined, offset: undefined }).findByIds(
        ranked.map((row) => row.id),
        execute,
      );
      const byId = new Map(games.map((game) => [(game as { id: number }).id, game]));
      for (const { id, value } of ranked) {
        const game = byId.get(id);
        if (game !== undefined && results.length < limit) results.push({ game, value });
      }
      if (page.length < pageSize) break;
    }
    return results;
  }

  /**
   * Iterates over every match with an id cursor (`where id > last; sort id asc`), `pageSize` at a
   * time. Stable even if entities are added meanwhile, and fast at any depth unlike `offset`.
   */
  async *iterate(options: ExecuteOptions & { pageSize?: number } = {}): AsyncGenerator<R, void, undefined> {
    for await (const page of this.cursorPages(options.pageSize ?? MAX_LIMIT, options)) yield* page;
  }

  /**
   * Every match, page by page, to copy an endpoint into your own storage. Pass `since` (the time you
   * started the previous sync) to get only what changed since then. Large result sets are fetched as
   * id ranges sent in parallel, which automatic batching packs into multiqueries; small ones with an
   * id cursor. Requests default to `background` priority so they wait behind interactive ones.
   * Pages arrive in id order.
   */
  async *sync(
    options: SyncOptions &
      ("updated_at" extends keyof Endpoints[N] ? { since?: Date | number } : { since?: never }) = {},
  ): AsyncGenerator<R[], void, undefined> {
    if (this.state.search) throw new QueryError("sync() cannot be combined with search");
    const executeOptions: ExecuteOptions = { ...options, priority: options.priority ?? "background" };
    let query: Query<N, R> = this.with({
      fields: this.fieldsWithId(),
      sort: undefined,
      offset: undefined,
      limit: undefined,
    });
    if (options.since !== undefined) {
      if (!(entities[this.entity] && "updated_at" in (entities[this.entity] as object))) {
        throw new QueryError(`${this.endpoint} has no updated_at field: sync it without since`);
      }
      const seconds = Math.floor(
        (options.since instanceof Date ? options.since.getTime() : options.since) / 1000,
      );
      query = query.where(`updated_at >= ${seconds}`);
    }

    const total = await query.count().execute(executeOptions);
    if (total === 0) return;
    if (total <= (options.cursorThreshold ?? 5000)) {
      yield* query.cursorPages(MAX_LIMIT, executeOptions);
      return;
    }

    const last = await query
      .with({ fields: ["id"], sort: { field: "id", direction: "desc" } })
      .first()
      .execute(executeOptions);
    const maxId = (last as { id: number } | null)?.id ?? 0;
    const window = Math.max(1, options.concurrency ?? 40);
    const pending: Promise<R[]>[] = [];
    let next = 0;
    const launch = () => {
      if (next > maxId) return;
      const from = next;
      next += MAX_LIMIT;
      const page = query
        .with({ sort: { field: "id", direction: "asc" }, limit: MAX_LIMIT })
        .where(`id >= ${from} & id < ${from + MAX_LIMIT}`)
        .execute(executeOptions);
      page.catch(() => {}); // awaited in order below; avoid unhandled rejections meanwhile
      pending.push(page);
    };
    for (let i = 0; i < window; i++) launch();
    while (pending.length > 0) {
      const page = await (pending.shift() as Promise<R[]>);
      launch();
      if (page.length > 0) yield page;
    }
  }

  private fieldsWithId(): readonly string[] {
    const { fields } = this.state;
    return fields.length && !fields.includes("id") && !fields.includes("*") ? [...fields, "id"] : fields;
  }

  private async *cursorPages(
    pageSize: number,
    options: ExecuteOptions,
  ): AsyncGenerator<R[], void, undefined> {
    if (this.state.search) throw new QueryError("iterate() cannot be combined with search");
    const base = this.with({
      fields: this.fieldsWithId(),
      sort: { field: "id", direction: "asc" },
      offset: undefined,
    });
    let last = -1;
    for (;;) {
      const page = await base.where(`id > ${last}`).limit(pageSize).execute(options);
      if (page.length > 0) yield page;
      if (page.length < pageSize) return;
      last = (page[page.length - 1] as { id: number }).id;
    }
  }

  /** @internal */
  toRequest(kind: "list" | "count" = "list"): QueryRequest {
    const { fields, where, sort, search, limit, offset, cacheTtlMs } = this.state;
    const lines: string[] = [];
    if (kind === "list" && fields.length) lines.push(`fields ${fields.join(",")};`);
    if (search !== undefined) lines.push(`search ${JSON.stringify(search)};`);
    if (where) lines.push(`where ${where};`);
    if (kind === "list") {
      if (sort) lines.push(`sort ${sort.field} ${sort.direction};`);
      if (limit !== undefined) lines.push(`limit ${limit};`);
      if (offset !== undefined) lines.push(`offset ${offset};`);
    }
    const body = lines.join(" ");
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
      throw new QueryError(`Query body exceeds IGDB's 32 KB limit; split long id lists (findByIds does it)`);
    }
    return {
      endpoint: this.endpoint,
      path: kind === "count" ? `${this.endpoint}/count` : this.endpoint,
      body,
      kind,
      hasSearch: search !== undefined,
      fields,
      limit: kind === "count" ? 0 : (limit ?? 10),
      cacheTtlMs,
    };
  }

  /** @internal */
  parse(response: RawResponse): R[] {
    return response.data as R[];
  }
}

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

function toId(id: number): number {
  if (!Number.isSafeInteger(id) || id < 0) throw new QueryError(`Invalid id: ${id}`);
  return id;
}

function endpointEntity(endpoint: EndpointName): string {
  return endpoints[endpoint].entity;
}
