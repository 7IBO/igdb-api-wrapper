# igdb-kit

A fully typed IGDB API client for Node.js and Bun.

- **Exact result types.** The type of every response is inferred from the fields you select: nested objects for expanded relations, ids for the others, and every field except `id` is optional because IGDB omits empty fields.
- **Generated from the official schema.** Entities come from IGDB's `igdbapi.proto`, merged with the API docs for descriptions and `@deprecated` notices. Fields IGDB replaced, such as `category`, are left out because they are never returned. All 81 documented endpoints are included, `executables` and `logos` among them.
- **Field paths checked twice.** TypeScript checks them as you type, and they are checked again at runtime before the request leaves. IGDB rejects a whole multiquery for one bad field and silently ignores an unknown `sort` field.
- **Rate limit done right.** One limiter per client id, shared by every client in the process (4 requests per second, 8 in flight). After a 429 the whole queue pauses and slows down, because IGDB sends no `Retry-After`.
- **Automatic multiquery.** Queries started at the same time are grouped into `/multiquery` requests of up to 10 blocks, so 30 `findById` calls cost 3 HTTP requests. Batches are sized by estimated response size to stay under IGDB's 10 MB cap. An invalid query or an oversized response is isolated by splitting the batch, so only the faulty query fails. Identical queries in flight are sent once.
- **Auth that recovers.** Tokens are fetched once for all concurrent requests, renewed before they expire, and renewed then replayed once after a 401. A token store can be shared across processes, since Twitch keeps only 25 active tokens per app.

> Status: early development, not published yet. Redis adapters, webhooks and a sync helper come next.

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

`GameType`, `GameStatus`, `GameReleaseFormat`, `Genre`, `Theme`, `GameMode`, `PlayerPerspective`, `Platform`, `PlatformType`, `ExternalGameSource`, `PopularityType`, `ReleaseDateRegion`, `DateFormat`, `WebsiteType`, `AgeRatingOrganization`, `LanguageSupportType`, `CharacterGender` and `CharacterSpecie` are generated from the API.

IGDB replaced several fields with reference tables: `games.category` became `game_type`, `release_dates.region` became `release_region`, `external_games.category` became `external_game_source`, and so on. IGDB still accepts the old names but never returns them, so `where category = 0` silently matches nothing. igdb-kit leaves them out of the types and throws a `QueryError` that names the replacement.

Avoid filters three levels deep, such as `involved_companies.company.name`: IGDB times out after about 27 seconds. Look the company id up first, then filter on `involved_companies.company`.

### Reading results

```ts
await igdb.games.select("name").first();                 // R | null
await igdb.games.select("name").findById(1942);          // R | null
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
  hooks: { onRetry, onRateLimited, onTokenRefresh },
});
```

Requests can be marked `priority: "background"` so they wait behind `interactive` ones, for example during a sync.

## Compatibility

Node.js 20 or later, and Bun. ESM and CommonJS. Types are tested on TypeScript 5.9, 6.0 and 7.0.

## Development

```sh
bun install
bun run codegen          # regenerate src/generated/schema.ts (--fetch downloads the latest proto and reference tables, with Twitch credentials)
bun run test             # unit tests
bun run test:types       # compile-time inference tests
bun run bench:types      # type-checking cost per query on each TypeScript version
TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… bun run --filter igdb-kit test:integration
```
