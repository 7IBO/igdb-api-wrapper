# igdb-kit

## 0.3.0

### Minor Changes

- e5c4aa4: New `igdb-kit/game` subpath: pure helpers that turn a selected game into what a page shows, with no request. `releaseDate()` picks the date to show by region, platform and status with its precision (day, month, quarter, year, TBD); `companies()`, `storeLinks()`, `ageRating()`, `localizedName()`, `languages()`, `multiplayer()`, `parentGame()`, `timeToBeat()` and `formatPlaytime()` cover the other fields. Each helper requires the fields it reads at compile time and keeps unknown data apart from "no".
- d368867: Link data across endpoints. `byGame()` fetches the rows that point to a list of games (time to beat, characters, release dates, websites, popularity…), grouped by game id, past 500 rows and batched. `igdb.defineView()` attaches them to games under typed keys, in one multiquery for a single game. `igdb.expand()` replaces ids with entities in one batched call, and keeps small reference tables such as platforms and genres in the cache. `defineSelection()` and `ResultOf<>` name and type a reusable set of fields.
- 31059f3: Adds `weightedPopular()`, which ranks games by several PopScore metrics at once, each scaled to its top value, with `null` for a game the metric does not track; `igdb.popularitySnapshot()`, which returns ranked popularity rows to store, since IGDB keeps no history; and `releases()`, a release calendar with one entry per game, each date labeled by its precision (day, month, quarter, year or TBD), statuses and regions handled, and windows in UTC days. Also adds the `ReleaseDateStatus` constants.
- e659640: `searchAll()` searches games, characters, collections, platforms and themes at once and returns typed hits narrowed by kind, with mods and editions left out and a ranking by name match (IGDB returns the newest entries first). `exclude()` leaves selected fields out of the response and its type, nested ones included. On `games`, `where` gains `developedBy()`, `publishedBy()` and `releasedIn()`, which rely on IGDB matching every condition on one array of relations against the same entry. New reference constants: `ReleaseDateStatus`, `Region`, `Language`, `AgeRatingCategory` (`PEGI_18`, `ESRB_M`…), `CompanyStatus`, `CompanySize`, `CompanyType`, `NetworkType`, `CollectionType`, `CollectionMembershipType`, `CollectionRelationType`, `PlatformFamily` and `ImageType`.

### Patch Changes

- fc5a47f: Fixes found by sending every operator to the real API: `notAll()` now throws a `QueryError` (IGDB has no such operator; its documented `= ![...]` is a syntax error), and `sort()` only takes fields of the queried endpoint, since IGDB silently ignores a sort on a relation's field such as `cover.width`. The `search` endpoint, which searches games, characters, companies and alternative names at once, now accepts `search()`.

## 0.2.0

### Minor Changes

- 3d0c48d: Response cache with `query.cache(ttlMs)` and the `cache` / `cacheTtlMs` client options, and a new `igdb-kit/redis` entry point: `redisTokenStore`, `redisLimiter` and `redisCache` share the token, the rate limit and the cache across processes, with ioredis, node-redis or Bun's Redis client.
- 2028ea9: Timestamp fields (`first_release_date`, `release_dates.date`, `updated_at`…) accept a `Date` in `where`, converted to the Unix seconds IGDB expects. Add `toDate()` and `toUnix()`.
- cfc6e62: Add `games.findByExternalIds(source, uids)`: the games behind store ids (Steam, GOG, Epic…), as a map from each found id to its game.
- 18e9670: Add `findByIdOrThrow()` and `firstOrThrow()`, which throw a `NotFoundError` instead of returning `null`.
- d2deace: Add `games.popular(type, { limit })`: the most popular games for a PopScore metric, in order and with their score. The query's `select` and `where` apply to the games.
- 3603124: Add `igdb-kit/proxy` and `createIGDB({ proxyUrl })`: query IGDB from the browser through your own server, which keeps the credentials and can restrict endpoints, cap `limit`, authorize requests and cache answers.
- cceb9c5: Add named ids for reference tables (`GameType`, `Platform`, `Theme`, `ExternalGameSource`, `PopularityType`, `ReleaseDateRegion`…), generated from the API.
  
  Fields IGDB replaced (`games.category`, `release_dates.region`, `external_games.category`…) are removed from the types and rejected with the name of their replacement: IGDB accepts them but leaves them empty or no longer updates them, so a filter on one silently matched nothing or too little. The legacy enums only those fields used (`GameCategoryEnum`…) are removed too.
- d19a150: `query.sync({ since })` copies an endpoint page by page in id order, fetching large sets as parallel id ranges packed into multiqueries, and only what changed since a date with `since`. `imageUrl(imageId, size, { retina, format })` builds IGDB image URLs from an `image_id` or from the `url` field IGDB returns.
- bed087b: Webhooks: `igdb.webhooks` registers, lists, tests and removes webhooks, and `ensure()` registers several endpoints at startup (idempotent, reactivates disabled ones). The new `igdb-kit/webhooks` entry point verifies deliveries and types them by endpoint and operation, with `webhookHandler` for fetch-style servers and `parseWebhook` for Express or Fastify.

### Patch Changes

- 217ab02: README: installation and Twitch credentials sections, badges, and an up-to-date status note.

## 0.1.0

### Minor Changes

- 64f5d72: First release: typed IGDB client with types generated from the official schema, exact result inference from selected fields, typed filters, a rate limiter shared per client id, automatic token renewal and typed errors.
- ccfbd11: Automatic multiquery batching: concurrent queries are grouped into multiqueries sized by estimated response size, invalid or oversized blocks are isolated by splitting, identical queries in flight are deduplicated, and `batch()` runs typed queries together.
