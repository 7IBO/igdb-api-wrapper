# Client, batching and servers

- [How requests are sent](#how-requests-are-sent): rate limit, tokens, multiquery
- [Options](#options) and [hooks](#hooks)
- [Batching](#batching)
- [Caching](#caching)
- [Several processes: Redis](#several-processes-redis)
- [In the browser: proxy](#in-the-browser-proxy)
- [Errors](#errors)

## How requests are sent

- **Rate limit.** One limiter per client id, shared by every client in the process (4 requests per second, 8 in flight). After a 429 the whole queue pauses and slows down, because IGDB sends no `Retry-After`. A second client with the same client id and other limiter options gets a console warning, since the first options win.
- **Automatic multiquery.** Queries started at the same time are grouped into `/multiquery` requests of up to 10 blocks, so 30 `findById` calls cost 3 HTTP requests. Batches are sized by estimated response size to stay under IGDB's 10 MB cap, and their bodies stay under its 32,000-byte limit. An invalid query or an oversized response is isolated by splitting the batch, so only the faulty query fails. Identical queries in flight are sent once.
- **Auth that recovers.** Tokens are fetched once for all concurrent requests, renewed before they expire, and renewed then replayed once after a 401. A token store can be shared across processes, since Twitch keeps only 25 active tokens per app.
- **Field paths checked twice.** TypeScript checks them as you type, and they are checked again at runtime before the request leaves. IGDB rejects a whole multiquery for one bad field and silently ignores an unknown `sort` field.

## Options

```ts
createIGDB({
  clientId,
  clientSecret,               // or accessToken: a token you manage (never renewed)
  tokenStore,                 // { get, set, delete, lock? }; default in memory
  limiter,                    // LocalLimiterOptions or your own Limiter; shared per clientId, first options win
  retryTimeoutMs: 30_000,
  attemptTimeoutMs: 30_000,
  autoBatch: true,            // group concurrent queries into multiqueries
  batchWindowMs: 2,           // how long to wait for more queries before sending
  maxBatchBytes: 4_000_000,   // target size of one multiquery response, and of a page
  maxBodyBytes: 32_000,       // largest multiquery body; 16_384 with proxyUrl, like igdbProxy
  cache,                      // CacheStore for cache()d queries; default in memory
  cacheTtlMs,                 // cache every query this long; default only cache()d ones
  hooks: { onRequest, onRetry, onRateLimited, onTokenRefresh },
});
```

Requests can be marked `priority: "background"` so they wait behind `interactive` ones, for example during a sync.

### Hooks

`hooks.onRequest` is called after every request, for logs and metrics: `{ path, method, status, durationMs, bytes, attempt, blocks, cached }`, where `status` is 0 when no answer came, `attempt` counts retries from 1, `blocks` is the number of queries in a multiquery and `cached` marks a response read from the cache. What it throws is ignored.

```ts
const igdb = createIGDB({
  clientId,
  clientSecret,
  hooks: { onRequest: (r) => console.log(`${r.path} ${r.status} ${r.durationMs} ms ${r.bytes} B${r.cached ? " cached" : ""}`) },
});
```

## Batching

Nothing to do: queries started within the same couple of milliseconds are sent together.

```ts
// 1 HTTP request
const [witcher, gta, zelda] = await Promise.all([1942, 1020, 7346].map((id) => igdb.games.select("name").findById(id)));
```

`batch()` makes it explicit and keeps each result's type under its key:

```ts
const { top, total, ps5 } = await igdb.batch({
  top: igdb.games.select("name", "cover.image_id").sort("rating", "desc").limit(5),
  total: igdb.games.where((g) => g.rating.gte(80)).count(),
  ps5: igdb.platforms.select("name").findById(167),
});
// top: { id: number; name?: string; cover?: { id: number; image_id?: string } }[]
// total: number
// ps5: { id: number; name?: string } | null
```

It also takes views, and the `Task` returned by the methods that take several requests, such as `findByIds()`, `findByGames()` or `popular()`: their first requests share the multiquery.

```ts
// 1 HTTP request
const { games, dates } = await igdb.batch({
  games: igdb.games.select("name").findByIds([1942, 1020]),
  dates: igdb.release_dates.select("date", "platform").findByGames([1942]),
});
```

Some queries are always sent alone: `search` queries (IGDB returns an empty multiquery when one block searches), `withCount()` (the total comes from a header multiquery does not have), and any query run with `execute({ batch: false })`. Set `autoBatch: false` to turn automatic grouping off; `batch()` still groups.

## Caching

```ts
const genres = await igdb.genres.select("name").limit(500).cache(24 * 3600_000); // kept a day
```

`cache(ttlMs)` keeps the response so identical queries skip IGDB and the rate limit. Responses live in memory by default, 1,000 of them and 50 MB at most, the least recently used going first; `cache: memoryCache({ maxEntries, maxBytes })` changes these limits, and a response above a quarter of `maxBytes` is not kept. Pass another `cache` to share responses (see Redis below). Set `cacheTtlMs` to cache every query, and `cache(false)` to opt one out. A failing cache store never fails a query.

## Several processes: Redis

IGDB counts the rate limit per client id, and Twitch keeps only 25 active tokens per app. When several processes or servers use the same app, share the token, the quota and the cache through Redis:

```ts
import { createIGDB } from "igdb-kit";
import { redisCache, redisLimiter, redisTokenStore } from "igdb-kit/redis";

const clientId = process.env.TWITCH_CLIENT_ID!;
const igdb = createIGDB({
  clientId,
  clientSecret: process.env.TWITCH_CLIENT_SECRET!,
  tokenStore: redisTokenStore(redis, { clientId }), // one token for every process, renewed by one
  limiter: redisLimiter(redis, { clientId }),       // 4 req/s and 8 in flight across all processes
  cache: redisCache(redis),
});
```

`redis` can be an [ioredis](https://github.com/redis/ioredis) client, a [node-redis](https://github.com/redis/node-redis) client, Bun's `RedisClient`, or a function sending one raw command. igdb-kit depends on none of them.

## In the browser: proxy

IGDB does not allow CORS, and your client secret must stay on the server. `igdbProxy` forwards the browser's queries through your server's client, with its credentials, rate limit, retries and cache:

```ts
// Server: a catch-all route, e.g. app/api/igdb/[...path]/route.ts in Next.js
import { igdbProxy } from "igdb-kit/proxy";

export const POST = igdbProxy({
  igdb,                                   // your server-side createIGDB() client
  endpoints: ["games", "covers", "platforms", "genres"], // default: all
  maxLimit: 50,                           // default 500
  authorize: (request) => request.headers.has("cookie"), // optional
  cacheTtlMs: 5 * 60_000,                 // optional, uses the client's cache
});
```

```ts
// Browser: the same typed API, no credentials
const igdb = createIGDB({ proxyUrl: "/api/igdb" });
const games = await igdb.games.select("name", "cover.image_id").search("zelda").limit(10);
```

The last path segment names the endpoint (`games`, `games/count`, `multiquery`), so batching keeps working. Only Apicalypse reads are forwarded, never the webhooks API. A refused query (endpoint not allowed, `limit` above `maxLimit`, `authorize` returning false) throws a `QueryError` in the browser.

`authorize` runs before the body is read, and a body above `maxBodyBytes` (16 KB by default) is answered 413 as soon as it passes the limit. The browser client keeps its multiqueries under 16 KB, and a single query that large throws a `PayloadTooLargeError`; if you raise the proxy's `maxBodyBytes`, pass the same value to `createIGDB`. For another origin, pass `allowOrigin`; `cacheControl` sets the `Cache-Control` header of answers.

## Errors

All errors extend `IGDBError` and carry `status`, `endpoint`, `details` (IGDB's own error entries) and the `query` that failed.

| Error | When |
|---|---|
| `QueryError` | Invalid field, syntax or type error, `limit` above 500 (IGDB answers 403 for that), unknown endpoint |
| `PayloadTooLargeError` | The response would exceed IGDB's 10 MB cap, or the request body exceeds 32,000 bytes: the message says which |
| `QueryTimeoutError` | IGDB gave up after about 27 s (408) |
| `TierError` | Data outside your API access tier (the `content_safety_*` endpoints) |
| `AuthError` | Bad credentials, or a token still refused after one renewal |
| `RateLimitError` | Still 429 when the retry budget ran out |
| `NotFoundError` | `findByIdOrThrow()` or `firstOrThrow()` found nothing, or a name in `named()`, `developedBy()` or `publishedBy()` matches nothing (`suggestions` lists close names) |
| `NetworkError` | 5xx or network failure that persisted |
| `IGDBError` | A response that is not JSON, such as a `proxyUrl` answering with an HTML page |

429, 5xx and network errors are retried with backoff until `retryTimeoutMs` (30 s by default) runs out. Every request accepts an `AbortSignal`: `query.execute({ signal })`.
