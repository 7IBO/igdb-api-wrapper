# igdb-kit

[![npm](https://img.shields.io/npm/v/igdb-kit)](https://www.npmjs.com/package/igdb-kit)
[![CI](https://github.com/7IBO/igdb-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/7IBO/igdb-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/igdb-kit)](https://github.com/7IBO/igdb-kit/blob/main/LICENSE)

A fully typed [IGDB](https://api-docs.igdb.com/) API client for Node.js and Bun, and for the browser through your own proxy.

- **Exact result types.** The type of every response is inferred from the fields you select: nested objects for expanded relations, ids for the others, and every field except `id` is optional because IGDB omits empty fields.
- **Generated from the official schema.** Entities come from IGDB's `igdbapi.proto`, merged with the API docs for descriptions and `@deprecated` notices. Fields IGDB replaced, such as `category`, are left out because they are empty or no longer updated. All 84 endpoints are included, `executables`, `logos` and the tier-restricted `content_safety_*` ones among them.
- **Field paths checked twice.** TypeScript checks them as you type, and they are checked again at runtime before the request leaves. IGDB rejects a whole multiquery for one bad field and silently ignores an unknown `sort` field.
- **Rate limit done right.** One limiter per client id, shared by every client in the process (4 requests per second, 8 in flight). After a 429 the whole queue pauses and slows down, because IGDB sends no `Retry-After`.
- **Automatic multiquery.** Queries started at the same time are grouped into `/multiquery` requests of up to 10 blocks, so 30 `findById` calls cost 3 HTTP requests. Batches are sized by estimated response size to stay under IGDB's 10 MB cap. An invalid query or an oversized response is isolated by splitting the batch, so only the faulty query fails. Identical queries in flight are sent once.
- **Auth that recovers.** Tokens are fetched once for all concurrent requests, renewed before they expire, and renewed then replayed once after a 401. A token store can be shared across processes, since Twitch keeps only 25 active tokens per app.

> Versions 0.x may change the API between minor releases. See the [changelog](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/CHANGELOG.md).

## Install

```sh
npm install igdb-kit
# or
bun add igdb-kit
```

You need a Twitch application: create one in the [Twitch developer console](https://dev.twitch.tv/console/apps) and use its client id and client secret. The client secret must stay on the server.

## Usage

```ts
import { and, createIGDB, or } from "igdb-kit";

const igdb = createIGDB({
  clientId: process.env.TWITCH_CLIENT_ID!,
  clientSecret: process.env.TWITCH_CLIENT_SECRET!,
});

const games = await igdb.games
  .select("name", "rating", "cover.image_id", "platforms.name", "genres")
  .where((g) => g.rating.gte(80).and(g.platforms.any(6, 48)))
  .sort("rating", "desc")
  .limit(10);
// {
//   id: number;
//   name?: string;
//   rating?: number;
//   cover?: { id: number; image_id?: string };
//   platforms?: { id: number; name?: string }[];
//   genres?: number[];          // not expanded: ids
// }[]
```

Queries are immutable and awaitable. They are compiled to Apicalypse, which you can inspect with `query.toApicalypse()`.

### Selecting fields

| Path | Result |
|---|---|
| `"name"` | `name?: string` |
| `"cover"` | `cover?: number` (the id) |
| `"cover.image_id"` | `cover?: { id: number; image_id?: string }` |
| `"platforms.*"` | every field of each platform |
| `"*"` | every field, relations as ids |
| `"involved_companies.company.name"` | nested as deep as you need |

### Filtering

```ts
igdb.games.where((g) => g.name.startsWith("Super"));                  // name ~ "Super"*
igdb.games.where((g) => g.name.contains("smash", { caseSensitive: true }));
igdb.games.where((g) => g.platforms.any(48, 49, 6));                   // platforms = (48,49,6)
igdb.games.where((g) => g.platforms.all(6, 48));                       // platforms = [6,48]
igdb.games.where((g) => g.themes.none(42));                            // themes != (42)
igdb.games.where((g) => g.cover.isNull());
igdb.games.where((g) => g.release_dates.platform.eq(6));               // filter on a relation's field
igdb.games.where((g) => or(and(g.rating.gte(80), g.hypes.gt(10)), g.total_rating_count.gt(100)));
igdb.games.where("rating > 80");                                       // raw Apicalypse
```

Each field only offers the operators that fit its type, and enum fields only accept their values.

Reference tables come with named ids, so you don't hard-code `game_type = 0` or `platforms = 48`:

```ts
import { GameType, Platform, Theme } from "igdb-kit";

igdb.games.where((g) =>
  and(
    g.game_type.in(GameType.MainGame, GameType.Remake, GameType.Remaster),
    g.version_parent.isNull(),                                          // no editions
    g.platforms.any(Platform.PlayStation5, Platform.PCMicrosoftWindows),
    g.themes.none(Theme.Erotic),
  ),
);
```

IGDB timestamps (`first_release_date`, `release_dates.date`, `updated_at`…) are Unix seconds, not milliseconds. Timestamp fields accept a `Date` in `where`, and `toDate()` / `toUnix()` convert the other way:

```ts
import { toDate } from "igdb-kit";

const upcoming = await igdb.release_dates
  .select("date", "human", "game.name")
  .where((r) => r.date.gte(new Date()))                               // date >= 1791504000
  .sort("date", "asc");
toDate(upcoming[0].date!);                                            // a Date
```

`GameType`, `GameStatus`, `GameReleaseFormat`, `Genre`, `Theme`, `GameMode`, `PlayerPerspective`, `Platform`, `PlatformType`, `ExternalGameSource`, `PopularityType`, `ReleaseDateRegion`, `ReleaseDateStatus`, `DateFormat`, `WebsiteType`, `AgeRatingOrganization`, `LanguageSupportType`, `CharacterGender` and `CharacterSpecie` are generated from the API.

IGDB replaced several fields with reference tables: `games.category` became `game_type`, `release_dates.region` became `release_region`, `external_games.category` became `external_game_source`, and so on. IGDB still accepts the old names but leaves them empty or no longer updates them, so `where category = 0` silently matches nothing. igdb-kit leaves them out of the types and throws a `QueryError` that names the replacement.

Avoid filters three levels deep, such as `involved_companies.company.name`: IGDB times out after about 27 seconds. Look the company id up first, then filter on `involved_companies.company`.

### Reading results

```ts
await igdb.games.select("name").first();                 // R | null
await igdb.games.select("name").findById(1942);          // R | null
await igdb.games.select("name").findByIdOrThrow(1942);   // R, or throws NotFoundError (also firstOrThrow())
await igdb.games.select("name").findByIds(ids);          // R[], in the order given, split by 500
await igdb.games.where((g) => g.rating.gte(90)).count(); // number
await igdb.games.select("name").limit(20).withCount();   // { data: R[]; total: number }, one request
for await (const game of igdb.games.select("name").iterate()) {
  // every match, paged with an id cursor (stable and fast at any depth, unlike offset)
}
await igdb.games.select("name").search("zelda").limit(5); // searchable endpoints only, no sort
```

### Store ids

`findByExternalIds()` finds games from their id on Steam, GOG, Epic, Xbox, PlayStation Store… (`ExternalGameSource`), for example to match a Steam library:

```ts
import { ExternalGameSource } from "igdb-kit";

const games = await igdb.games
  .select("name", "cover.image_id")
  .findByExternalIds(ExternalGameSource.Steam, ["292030", "570"]); // Map<string, game>
```

Store ids are strings in IGDB; numbers are accepted. Unknown ids are missing from the map.

### Popularity

`popular()` ranks games by one of IGDB's PopScore metrics and returns them in that order with their score. The query's fields and filters apply to the games:

```ts
import { GameType, PopularityType } from "igdb-kit";

const trending = await igdb.games
  .select("name", "cover.image_id")
  .where((g) => g.game_type.eq(GameType.MainGame))
  .popular(PopularityType.IGDBPlaying, { limit: 20 });   // { game, value }[]
```

The metrics are `IGDBVisits`, `IGDBWantToPlay`, `IGDBPlaying` and `IGDBPlayed`, plus Steam (`Steam24hrPeakPlayers`, `SteamGlobalTopSellers`, `SteamMostWishlistedUpcoming`…) and `Twitch24hrHoursWatched`. Popularity rows are read 500 at a time until enough games pass the filter, up to `maxRows` (5000 by default).

`weightedPopular()` ranks by several metrics at once. Their scales differ by orders of magnitude (IGDB visits top at 0.005, Steam peak players at 0.19), so each is divided by its top value before weighting:

```ts
const top = await igdb.games
  .select("name")
  .weightedPopular(
    { [PopularityType.IGDBWantToPlay]: 0.5, [PopularityType.Steam24hrPeakPlayers]: 0.5 },
    { limit: 20 },
  );
// { game, score, values: { 2: 0.0019, 5: null } }[]
```

`values` holds each metric's raw value, and `null` when IGDB has no row for the game: a third of the 500 most played games have no Steam row, which is not the same as a measured 0. Such a game scores 0 for that metric. Negative weights lower a score (`SteamNegativeReviews: -0.2`). Each round reads 500 rows per positively weighted metric, then the other metrics and the games of the new ids, in about 2 multiqueries; it stops as soon as no unread game can enter the top, usually after one round.

IGDB keeps only the latest value of each game and metric, so a trend needs your own history. `popularitySnapshot()` returns rows ready to store, one ranked array per metric:

```ts
for await (const rows of igdb.popularitySnapshot({ top: 1000 })) {
  await db.insertPopularity(rows); // { game_id, popularity_type, value, rank, calculated_at, external_popularity_source }[]
}
```

Key the history on `game_id`, `popularity_type` and `calculated_at`: each metric is recomputed on its own schedule (IGDB's daily, Steam's and Twitch's on other days), so running a snapshot twice the same day stores nothing new. `top` reads the 1000 most popular rows of each of the 11 metrics in 3 requests; without it, every row (about 700,000) is read with an id cursor per metric, the metrics' pages packed together: about 280 multiqueries, a bit over a minute at the default rate limit. `types` picks the metrics.

### Release calendar

`releases()` lists the games released in a window, one entry per game however many platforms, regions and statuses it has there:

```ts
import { Platform, ReleaseDateRegion, ReleaseDateStatus } from "igdb-kit";

const october = await igdb.games
  .select("name", "cover.image_id")
  .where((g) => g.game_type.eq(GameType.MainGame))
  .releases({
    from: "2026-10-01",
    to: "2026-11-01",                          // exclusive
    platforms: [Platform.PlayStation5, Platform.PCMicrosoftWindows],
    regions: [ReleaseDateRegion.Europe],       // worldwide releases count too
  });
// { game, release, releases }[], by date
// release: { precision: "day", start: Date, end: Date, human: "Oct 20, 2026", platform, region, status }
```

`release` is the game's most precise release in the window, then the earliest; `releases` lists them all. IGDB dates are not all days: `precision` is `"day"`, `"month"` (`Oct 2026`), `"quarter"` (`Q4 2026`), `"year"` or `"tbd"`, and `start` and `end` bound the period. A month, quarter or year is in the window when its whole period is, so `Q4 2026` is in October to December but not in October alone; `match: "overlap"` includes every period that overlaps the window. TBD dates are left out unless `precision` includes `"tbd"`, whatever the window.

Release dates are calendar days at 00:00 UTC, so the window is in UTC days: pass `"YYYY-MM-DD"` strings rather than local midnights. By default Offline and Cancelled dates are left out, and dates without a status, more than half of them, are kept. `statuses: [ReleaseDateStatus.FullRelease, null]` picks statuses, `null` standing for "no status".

A window costs one count, `ceil(dates / 500)` pages read in parallel and `ceil(games / 500)` for the games, packed into multiqueries: a month of upcoming releases (1,700 dates, 1,000 games) takes 3 HTTP requests. Above `maxRows` dates (10,000 by default), it throws instead: page through long periods month by month.

### Copying an endpoint: sync

IGDB encourages keeping your own copy. `sync()` reads every match page by page, in id order:

```ts
const startedAt = new Date();
for await (const page of igdb.games.select("*").sync({ since: lastSync })) {
  await db.upsertGames(page); // up to 500 games
}
lastSync = startedAt; // next time, only what changed since this run
```

Large sets are requested as id ranges in parallel, which batching packs into multiqueries: all 73,000 companies take about 20 requests and 6 seconds. With `since`, only entities whose `updated_at` is newer come back. Sync requests run at `background` priority, so interactive queries pass first. Pair it with webhooks to stay up to date between runs.

### Images

```ts
import { imageUrl } from "igdb-kit";

imageUrl(game.cover?.image_id, "cover_big", { retina: true });
// https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1wyy.jpg (undefined if there is no cover)
imageUrl(game.cover?.url, "cover_big"); // the url field IGDB returns (always t_thumb) works too
```

### Batching

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

Some queries are always sent alone: `search` queries (IGDB returns an empty multiquery when one block searches), `withCount()` (the total comes from a header multiquery does not have), and any query run with `execute({ batch: false })`. Set `autoBatch: false` to turn automatic grouping off; `batch()` still groups.

### Caching

```ts
const genres = await igdb.genres.select("name").limit(500).cache(24 * 3600_000); // kept a day
```

`cache(ttlMs)` keeps the response so identical queries skip IGDB and the rate limit. Responses live in memory by default; pass `cache` to share them (see Redis below). Set `cacheTtlMs` to cache every query, and `cache(false)` to opt one out. A failing cache store never fails a query.

### Several processes: Redis

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

### Webhooks

IGDB can POST every created, updated or deleted entity to your server. Register at startup: it is idempotent, and it reactivates webhooks IGDB turned off after 5 failed deliveries.

```ts
await igdb.webhooks.ensure({
  url: "https://example.com/igdb",
  secret: process.env.IGDB_WEBHOOK_SECRET!,
  endpoints: ["games", "platforms"], // create, update and delete for each
});
```

Then handle deliveries. `webhookHandler` checks the `X-Secret` header and types each event by endpoint and operation:

```ts
import { webhookHandler } from "igdb-kit/webhooks";

const handler = webhookHandler<"games" | "platforms">({
  secret: process.env.IGDB_WEBHOOK_SECRET!,
  onEvent: async (event) => {
    if (event.operation === "delete") return db.remove(event.endpoint, event.data.id);
    if (event.endpoint === "games") await db.saveGame(event.data); // every field, relations as ids
  },
});

Bun.serve({ routes: { "/igdb": { POST: handler } } }); // or Hono: app.post("/igdb", (c) => handler(c.req.raw))
```

It answers 401 on a wrong secret and 500 when `onEvent` throws, so IGDB retries. With Express, use `parseWebhook({ headers: req.headers, body: req.body, url: req.url }, secret)`. `igdb.webhooks` also has `register`, `list`, `get`, `delete` and `test`.

### In the browser: proxy

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

The last path segment names the endpoint (`games`, `games/count`, `multiquery`), so batching keeps working. Only Apicalypse reads are forwarded, never the webhooks API. A refused query (endpoint not allowed, `limit` above `maxLimit`, `authorize` returning false) throws a `QueryError` in the browser. For another origin, pass `allowOrigin`; `cacheControl` sets the `Cache-Control` header of answers.

### Errors

All errors extend `IGDBError` and carry `status`, `details` (IGDB's own error entries) and the `query` that failed.

| Error | When |
|---|---|
| `QueryError` | Invalid field, syntax or type error, `limit` above 500 (IGDB answers 403 for that), unknown endpoint |
| `PayloadTooLargeError` | The response would exceed IGDB's 10 MB cap, or the request body exceeds 32 KB |
| `QueryTimeoutError` | IGDB gave up after about 27 s (408) |
| `TierError` | Data outside your API access tier (the `content_safety_*` endpoints) |
| `AuthError` | Bad credentials, or a token still refused after one renewal |
| `RateLimitError` | Still 429 when the retry budget ran out |
| `NotFoundError` | `findByIdOrThrow()` or `firstOrThrow()` found nothing |
| `NetworkError` | 5xx or network failure that persisted |

429, 5xx and network errors are retried with backoff until `retryTimeoutMs` (30 s by default) runs out. Every request accepts an `AbortSignal`: `query.execute({ signal })`.

### Options

```ts
createIGDB({
  clientId,
  clientSecret,               // or accessToken: a token you manage (never renewed)
  tokenStore,                 // { get, set, delete, lock? }; default in memory
  limiter,                    // LocalLimiterOptions or your own Limiter; default shared per clientId
  retryTimeoutMs: 30_000,
  attemptTimeoutMs: 30_000,
  autoBatch: true,            // group concurrent queries into multiqueries
  batchWindowMs: 2,           // how long to wait for more queries before sending
  maxBatchBytes: 4_000_000,   // target size of one multiquery response
  cache,                      // CacheStore for cache()d queries; default in memory
  cacheTtlMs,                 // cache every query this long; default only cache()d ones
  hooks: { onRetry, onRateLimited, onTokenRefresh },
});
```

Requests can be marked `priority: "background"` so they wait behind `interactive` ones, for example during a sync.

## Compatibility

Node.js 20 or later, and Bun; browsers through `igdb-kit/proxy`. ESM and CommonJS. Types are tested on TypeScript 5.9, 6.0 and 7.0.

## Development

```sh
bun install
bun run codegen          # regenerate src/generated/schema.ts (--fetch downloads the latest proto and reference tables, with Twitch credentials)
bun run audit            # check every field against the live API (types, unknown fields), with Twitch credentials
bun run test             # unit tests
bun run test:types       # compile-time inference tests
bun run bench:types      # type-checking cost per query on each TypeScript version
TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… bun run --filter igdb-kit test:integration
REDIS_URL=redis://localhost:6379 bun run --filter igdb-kit test:redis
```
