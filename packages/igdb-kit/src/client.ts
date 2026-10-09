import { Batcher, type BatcherOptions } from "./batch/batcher";
import { type CacheStore, cacheKey, memoryCache, parseResponse, serializeResponse } from "./cache";
import { TokenProvider, type TokenStore } from "./core/auth";
import { IGDBError, QueryError } from "./core/errors";
import { type Limiter, type LocalLimiterOptions, sharedLimiter } from "./core/limiter";
import { blocksOf, reportRequest, Transport, type TransportHooks } from "./core/transport";
import { type EndpointName, endpoints, type Game, PopularityType } from "./generated/schema";
import { gameLink } from "./links/by-game";
import { type Expanded, expand, type IdKeys } from "./links/expand";
import { type NoGameFields, View, type ViewLinks } from "./links/view";
import { resolveLookups } from "./query/lookups";
import {
  type PopularityRow,
  type PopularitySnapshotOptions,
  type PopularitySnapshotRow,
  popularitySnapshot,
} from "./query/popularity";
import {
  type ExecuteOptions,
  GameLinkedQuery,
  GamesQuery,
  MAX_BODY_BYTES,
  MAX_LIMIT,
  Query,
  type QueryOf,
  type QueryRequest,
  type QueryRunner,
  type RawResponse,
} from "./query/query";
import { type SearchAll, type SearchAllOptions, searchAll } from "./query/search-all";
import { Task } from "./query/task";
import type { FieldPath, SelectResult } from "./query/types";
import { Webhooks } from "./webhooks/api";

interface CommonClientOptions extends BatcherOptions {
  /**
   * Rate limiter. Default: one limiter per client id (or proxy URL) shared by every client in the
   * process (4 requests per second, 8 in flight). Pass options to tune it, or your own (e.g. Redis-backed).
   */
  limiter?: Limiter | LocalLimiterOptions | undefined;
  /** Total retry budget per request (429, 5xx, network). Default 30 s. */
  retryTimeoutMs?: number | undefined;
  /** Timeout of one HTTP attempt. Default 30 s. */
  attemptTimeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
  hooks?: (TransportHooks & { onTokenRefresh?: (info: { expiresAt: number }) => void }) | undefined;
  /**
   * Where `cache()`d responses are kept. Default: in memory, per client. Use `redisCache()` from
   * `igdb-kit/redis` to share them across processes. Cache errors never fail a query.
   */
  cache?: CacheStore | undefined;
  /** Cache every query for this long unless it calls `cache(false)`. Default: only `cache()`d queries. */
  cacheTtlMs?: number | undefined;
}

/** A client that calls IGDB with your Twitch credentials. Server side only. */
export interface IGDBServerClientOptions extends CommonClientOptions {
  /** Twitch application client id. */
  clientId: string;
  /** Twitch application secret, used to obtain and renew app access tokens. */
  clientSecret?: string | undefined;
  /** A token you manage yourself, instead of `clientSecret`. Never renewed. */
  accessToken?: string | undefined;
  /** Where to keep the token. Default: in memory. Use a shared store across processes. */
  tokenStore?: TokenStore | undefined;
  baseUrl?: string | undefined;
  /** Allow running in a browser. Your client secret would be exposed: use `proxyUrl` instead. */
  dangerouslyAllowBrowser?: boolean | undefined;
  proxyUrl?: undefined;
}

/**
 * A client that sends its queries to your own proxy (see `igdb-kit/proxy`), which holds the
 * credentials. Works in the browser.
 */
export interface IGDBProxyClientOptions extends CommonClientOptions {
  /** URL of your proxy, absolute or relative to the page (`/api/igdb`). */
  proxyUrl: string;
  clientId?: undefined;
  clientSecret?: undefined;
  accessToken?: undefined;
}

export type IGDBClientOptions = IGDBServerClientOptions | IGDBProxyClientOptions;

/** What `batch()` runs: a query, a view or a task, anything awaited that takes request options. */
// biome-ignore lint/suspicious/noExplicitAny: any result type is accepted.
type Batchable = PromiseLike<any> & { execute(options?: ExecuteOptions): Promise<any> };
type BatchInput = Record<string, Batchable>;
export type BatchResult<T extends BatchInput> = { [K in keyof T]: Awaited<T[K]> };

/**
 * The client: one query per endpoint (`igdb.games`, `igdb.platforms`…), typed by `QueryOf` so that
 * each has only the methods that work on it, and the methods below.
 */
export type IGDBClient = { readonly [K in EndpointName]: QueryOf<K> } & {
  /**
   * Runs several queries, views and tasks together, and returns each result under its key with its
   * own type. Requests sent at the same time go as few multiqueries as possible (10 per request), so
   * single queries take one multiquery and tasks such as `findByIds()` or `popular()` share theirs.
   * Works even when `autoBatch` is off.
   */
  batch<T extends BatchInput>(queries: T, options?: Omit<ExecuteOptions, "batch">): Promise<BatchResult<T>>;
  /**
   * Searches games, characters, collections, platforms and themes at once, through the `search`
   * endpoint, and returns typed hits narrowed by `kind`. Mods, DLCs and editions are left out of game
   * hits by default, and hits are ranked by how well their name matches (IGDB itself returns the most
   * recently indexed first). One request per 500 matches; never batched.
   */
  searchAll: SearchAll;
  /** Registers, lists and removes your app's webhooks. */
  webhooks: Webhooks;
  /**
   * Today's PopScore rows, one ranked array per type, to store: IGDB keeps only the latest value of
   * each game and type, so a history is built from your own snapshots. `limit` reads only the most
   * popular rows of each type (`ceil(limit / 500)` requests per type); without it every row is read
   * (about 700,000 rows: some 145 multiqueries, 40 s at the default rate limit). Runs at `background`
   * priority.
   */
  popularitySnapshot(
    options?: PopularitySnapshotOptions,
  ): AsyncGenerator<PopularitySnapshotRow[], void, undefined>;
  /** Sends a raw Apicalypse body to a path (`games`, `games/count`, `multiquery`). */
  raw<T = unknown>(path: string, body: string, options?: ExecuteOptions): Promise<T>;
  /**
   * Defines games with data from other endpoints attached, each under its key: time to beat,
   * characters, release dates, websites… (any endpoint that points to games, see `findByGames()`).
   *
   * ```ts
   * const gamePage = igdb.defineView("games", {
   *   select: ["name", "cover.image_id"],
   *   with: {
   *     timeToBeat: igdb.game_time_to_beats.select("normally", "completely"),
   *     characters: igdb.characters.select("name", "mug_shot.image_id"),
   *   },
   * });
   * await gamePage.findById(1942);                    // one multiquery
   * await gamePage.where((g) => g.rating.gte(90)).limit(20); // games, then all their links at once
   * ```
   */
  defineView<P extends string = never, W extends ViewLinks = Record<never, never>>(
    endpoint: "games",
    definition: { select?: readonly FieldPath<Game, P>[]; with?: W & NoGameFields },
  ): View<SelectResult<Game, P>, W>;
  /**
   * Replaces the ids under `key` in each row by the entities `target` returns, in one batched call:
   * `igdb.expand(games, "platforms", igdb.platforms.select("name"))`. Reference tables (platforms,
   * genres, themes, languages…) are loaded whole and cached for a day, so they usually cost nothing.
   */
  expand<T extends object, K extends IdKeys<T>, N extends EndpointName, E>(
    rows: readonly T[],
    key: K,
    target: Query<N, E>,
  ): Task<Expanded<T, K, E>[]>;
};

/** Sends a query as is, without batching, through the cache. Used by `igdb-kit/proxy`. */
export type Forward = (
  path: string,
  body: string,
  options: { cacheTtlMs?: number | undefined; signal?: AbortSignal | undefined },
) => Promise<RawResponse>;
/** In the global symbol registry so the proxy finds it whichever build (ESM or CJS) made the client. */
export const forwardKey: unique symbol = Symbol.for("igdb-kit.forward");

export function createIGDB(options: IGDBClientOptions): IGDBClient {
  const transport = options.proxyUrl === undefined ? directTransport(options) : proxyTransport(options);
  const batcher = new Batcher((path, body, sendOptions) => transport.send(path, body, sendOptions), {
    ...options,
    // igdbProxy refuses bodies above its maxBodyBytes, 16,384 by default.
    maxBodyBytes: options.maxBodyBytes ?? (options.proxyUrl === undefined ? MAX_BODY_BYTES : 16_384),
  });
  const pageBytes = options.maxBatchBytes ?? 4_000_000;
  let cache = options.cache;
  const cached = async (
    path: string,
    body: string,
    ttlMs: number,
    send: () => Promise<RawResponse>,
  ): Promise<RawResponse> => {
    if (ttlMs <= 0) return send();
    cache ??= memoryCache();
    const store = cache;
    const key = await cacheKey(path, body);
    const hit = await store.get(key).catch(() => undefined);
    if (hit) {
      const response = parseResponse(hit);
      reportRequest(options.hooks, {
        path,
        method: "POST",
        status: 200,
        durationMs: 0,
        bytes: response.bytes ?? new TextEncoder().encode(hit).length,
        attempt: 1,
        blocks: blocksOf(path, body),
        cached: true,
      });
      return response;
    }
    const response = await send();
    await store.set(key, serializeResponse(response), ttlMs).catch(() => {});
    return response;
  };
  const runner: QueryRunner = {
    run: async (request: QueryRequest, runOptions?: ExecuteOptions): Promise<RawResponse> => {
      // Company names (`developedBy("Nintendo")`) become ids first: their cache and batch keys are the ids.
      const sent = request.lookups?.length ? await resolveLookups(request, runner, runOptions) : request;
      return cached(sent.path, sent.body, sent.cacheTtlMs ?? options.cacheTtlMs ?? 0, () =>
        batcher.run(sent, runOptions),
      );
    },
    pageSize: (endpoint, fields) => {
      const rowBytes = batcher.sizes.rowBytes(endpoint, fields);
      const rows = Math.max(1, Math.min(MAX_LIMIT, Math.floor(pageBytes / rowBytes)));
      return { rows, bytes: rows * rowBytes };
    },
  };

  const client: Record<string, unknown> = {
    batch: async (queries: BatchInput, batchOptions?: ExecuteOptions) => {
      const keys = Object.keys(queries);
      const results = await Promise.all(
        keys.map((key) => (queries[key] as BatchInput[string]).execute({ ...batchOptions, batch: true })),
      );
      return Object.fromEntries(keys.map((key, i) => [key, results[i]]));
    },
    searchAll: (term: string, searchOptions?: SearchAllOptions) =>
      new Task((execute) =>
        searchAll(
          {
            search: client.search as Query<"search">,
            alternative_names: client.alternative_names as Query<"alternative_names">,
            game_localizations: client.game_localizations as Query<"game_localizations">,
          },
          term,
          searchOptions,
          execute,
        ),
      ),
    webhooks: new Webhooks((method, path, body, requestOptions) =>
      transport.request(
        method,
        path,
        { body, contentType: body === undefined ? undefined : "application/x-www-form-urlencoded" },
        requestOptions,
      ),
    ),
    popularitySnapshot: (snapshotOptions: PopularitySnapshotOptions = {}) =>
      popularitySnapshot(
        new Query<EndpointName, PopularityRow>(runner, "popularity_primitives", {
          fields: ["game_id", "popularity_type", "value", "calculated_at", "external_popularity_source"],
          sort: { field: "value", direction: "desc" },
        }),
        typeof snapshotOptions.types === "number"
          ? [snapshotOptions.types]
          : (snapshotOptions.types ?? Object.values(PopularityType)),
        snapshotOptions,
      ),
    raw: async (path: string, body: string, runOptions?: ExecuteOptions) =>
      (await transport.send(path, body, runOptions)).data,
    defineView: (endpoint: string, definition: { select?: readonly string[]; with?: ViewLinks }) => {
      if (endpoint !== "games") throw new QueryError(`Views are defined on games, not ${endpoint}`);
      const games = (client.games as GamesQuery).select(...((definition.select ?? []) as never[]));
      return new View(games, definition.with ?? {});
    },
    expand: (rows: readonly object[], key: never, target: never) =>
      new Task((execute) => expand(rows, key, target, execute)),
    [forwardKey]: ((path, body, forwardOptions) =>
      cached(path, body, forwardOptions.cacheTtlMs ?? 0, () =>
        transport.send(path, body, { signal: forwardOptions.signal }),
      )) satisfies Forward,
  };
  for (const endpoint of Object.keys(endpoints) as EndpointName[]) {
    client[endpoint] =
      endpoint === "games"
        ? new GamesQuery(runner, endpoint)
        : gameLink(endpoint) === undefined
          ? new Query(runner, endpoint)
          : new GameLinkedQuery(runner, endpoint as never);
  }
  return client as IGDBClient;
}

function directTransport(options: IGDBServerClientOptions): Transport {
  if (
    !options.dangerouslyAllowBrowser &&
    typeof (globalThis as { document?: unknown }).document !== "undefined"
  ) {
    throw new IGDBError(
      "igdb-kit calls IGDB from the server: in a browser your client secret would leak and IGDB does not allow CORS. " +
        "Pass proxyUrl to go through your own proxy (see igdb-kit/proxy).",
    );
  }
  const tokens = new TokenProvider({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    accessToken: options.accessToken,
    store: options.tokenStore,
    fetch: options.fetch,
    onTokenRefresh: options.hooks?.onTokenRefresh,
  });
  return new Transport({
    clientId: options.clientId,
    tokens,
    limiter: limiterFor(options.clientId, options.limiter),
    fetch: options.fetch,
    baseUrl: options.baseUrl,
    retryTimeoutMs: options.retryTimeoutMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    hooks: options.hooks,
  });
}

function proxyTransport(options: IGDBProxyClientOptions): Transport {
  return new Transport({
    limiter: limiterFor(`proxy:${options.proxyUrl}`, options.limiter),
    fetch: options.fetch,
    baseUrl: options.proxyUrl,
    retryTimeoutMs: options.retryTimeoutMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    hooks: options.hooks,
  });
}

function limiterFor(key: string, limiter: Limiter | LocalLimiterOptions | undefined): Limiter {
  return limiter && "acquire" in limiter ? limiter : sharedLimiter(key, limiter);
}
