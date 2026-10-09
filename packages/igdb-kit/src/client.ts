import { Batcher, type BatcherOptions } from "./batch/batcher";
import { type CacheStore, cacheKey, memoryCache, parseResponse, serializeResponse } from "./cache";
import { TokenProvider, type TokenStore } from "./core/auth";
import { IGDBError } from "./core/errors";
import { type Limiter, type LocalLimiterOptions, sharedLimiter } from "./core/limiter";
import { Transport, type TransportHooks } from "./core/transport";
import { type EndpointName, endpoints } from "./generated/schema";
import {
  type Executable,
  type ExecuteOptions,
  Query,
  type QueryRequest,
  type QueryRunner,
  type RawResponse,
} from "./query/query";
import { type SearchAll, type SearchAllOptions, searchAll } from "./query/search-all";
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

// biome-ignore lint/suspicious/noExplicitAny: any executable result type is accepted.
type BatchInput = Record<string, Executable<any>>;
export type BatchResult<T extends BatchInput> = { [K in keyof T]: Awaited<T[K]> };

export type IGDBClient = { readonly [K in EndpointName]: Query<K> } & {
  /**
   * Runs several queries together, as few multiqueries as possible (10 per request), and returns
   * each result under its key with its own type. Works even when `autoBatch` is off.
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
  /** Sends a raw Apicalypse body to a path (`games`, `games/count`, `multiquery`). */
  raw<T = unknown>(path: string, body: string, options?: ExecuteOptions): Promise<T>;
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
  const batcher = new Batcher((path, body, sendOptions) => transport.send(path, body, sendOptions), options);
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
    if (hit) return parseResponse(hit);
    const response = await send();
    await store.set(key, serializeResponse(response), ttlMs).catch(() => {});
    return response;
  };
  const runner: QueryRunner = {
    run: (request: QueryRequest, runOptions?: ExecuteOptions): Promise<RawResponse> =>
      cached(request.path, request.body, request.cacheTtlMs ?? options.cacheTtlMs ?? 0, () =>
        batcher.run(request, runOptions),
      ),
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
      searchAll(client.search as Query<"search">, term, searchOptions),
    webhooks: new Webhooks((method, path, body, requestOptions) =>
      transport.request(
        method,
        path,
        { body, contentType: body === undefined ? undefined : "application/x-www-form-urlencoded" },
        requestOptions,
      ),
    ),
    raw: async (path: string, body: string, runOptions?: ExecuteOptions) =>
      (await transport.send(path, body, runOptions)).data,
    [forwardKey]: ((path, body, forwardOptions) =>
      cached(path, body, forwardOptions.cacheTtlMs ?? 0, () =>
        transport.send(path, body, { signal: forwardOptions.signal }),
      )) satisfies Forward,
  };
  for (const endpoint of Object.keys(endpoints) as EndpointName[]) {
    client[endpoint] = new Query(runner, endpoint);
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
