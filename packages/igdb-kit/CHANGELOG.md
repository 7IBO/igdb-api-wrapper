# igdb-kit

## 0.4.1

### Patch Changes

- e65c4c3: `artworks.artwork_type` is back in the types and accepted in queries, marked deprecated. IGDB replaced it with `image_type` but fills `image_type` on 51% of artworks and `artwork_type` on 99.5%, so following the error igdb-kit threw lost the type of half the artworks. The new `artworkType()` returns an artwork's `ImageType`: its `image_type`, else its `artwork_type` converted, since the two tables number some types differently (8 is "Infographic" in `artwork_types` and "Main cover" in `image_types`, 9 and 10 are swapped, 12 to 15 are one apart). `ArtworkType` holds the ids of `artwork_types`.
- 7b5d36e: Automatic batching keeps each multiquery body under IGDB's 32,000-byte limit. A batch of long queries, such as `findByIds()` of 6,000 ids, was sent whole, refused with a 413 and only then split, which cost a request. Through `proxyUrl`, bodies stay under 16 KB, the default `maxBodyBytes` of `igdbProxy`; the new `maxBodyBytes` client option sets another limit.
- 73cfcd4: `memoryCache()`, the default cache, keeps 50 MB of responses at most (`maxBytes`), the least recently used going first, and does not keep a response above a quarter of it. It only counted responses (1,000), so caching every query (`cacheTtlMs`) while reading pages of several MB could hold gigabytes.
- 7b5d36e: `findByIds()`, `iterate()`, `sync()` and `byGame()` size their pages by weight, near `maxBatchBytes` (4 MB): 500 rows of a light selection, fewer of a heavy one. 500 popular games with their media, companies and release dates expanded made pages of 8.8 to 9.7 MB, next to IGDB's 10 MB cap; they are now read in pages of about 4 MB. A page IGDB still refuses, with a 413 above 10 MB or a 504 when it gives up building it after 29 seconds, is read again in halves instead of failing. Response sizes are measured in bytes rather than characters, and `iterate()` throws a `QueryError` for a `pageSize` outside 1 to 500.
- 9259b8a: `popular()` and `weightedPopular()` give the exact ranking when a `where` matches few games. They read popularity rows in value order until enough games passed the filter, and gave up after `maxRows` with a partial list when those games are rarely popular: the 20 most visited games released only on Switch 2 came back as 14 games after 20 requests. The games a `where` matches are now counted along with the first page (the first round for `weightedPopular()`); when it falls short and they are at most 10,000, their own rows are read instead, which gives all 20 in 4 requests. Equal values are ranked by id, and `weightedPopular()` reads the top value of negatively weighted types with its first round instead of before it.
- 9259b8a: `popularitySnapshot()` without `top` reads every row (about 700,000) in 40 seconds and 145 requests instead of 103 seconds and 305. The types are counted, then each type's pages are read in id order with offsets, all requested at once, two types at a time; the cursor of the largest type no longer sets the pace. Every type was held until the end; three are held at most.
- 2681de8: `sync()` takes far fewer requests, wherever the matching ids lie. The first page goes out with the count; the other pages are requested in parallel, packed into multiqueries, each asking for the matches after a row already read and skipping those the pages in between hold, so every page comes back full. A day of changes on `games` (about 33,000) takes 8 requests and 3 seconds instead of 87 and 22, all 73,000 companies with `*` 26 requests instead of 90, and the 133,000 rows of one popularity type, crowded into a few stretches of ids, 28 requests and 7 seconds. Matches added or removed during the sync shift the pages: repeated rows are dropped and rows a page skipped past are read again, so none is missed. Sets of up to 5,000 matches, read one page after another until now, are read the same way (`cursorThreshold` defaults to 0). At most `concurrency` pages and about 64 MB are requested or waiting at once, where 40 pages of heavy rows could hold several hundred MB.

## 0.4.0

### Minor Changes

- b253bfa: `developedBy()` and `publishedBy()` also take company names, matched in full and ignoring case: `g.developedBy("CD Projekt RED")`. The names are looked up in `companies` first (cached for a day) and the query filters on their ids, which IGDB answers in well under a second instead of 10 to 25. A name that matches no company throws a `NotFoundError` with the companies that contain it in `suggestions`.

### Patch Changes

- 8cecbf7: Queries are checked against IGDB's real body limit, 32,000 bytes rather than 32,768, and a `PayloadTooLargeError` now says whether the request body or the response is too large. Network and rate limit errors now carry their `endpoint` like the others, and a response that is not JSON (a `proxyUrl` answering with an HTML page) throws an `IGDBError` instead of a `SyntaxError`.
- f2a1209: The package now ships its `CHANGELOG.md`, and every version gets a GitHub release with the same notes.
- 8cecbf7: `findById()`, `findByIdOrThrow()` and `findByIds()` ignore the query's `offset` and `sort`: `igdb.games.offset(10).findById(1942)` returned null. `expand()`, which looks entities up with `findByIds()`, gets the fix too.
- 8cecbf7: `byGame()`, views and `searchAll()` no longer lose data when the same call runs twice at once. They modified the rows of the response, which the identical call in flight shares: the second call then found no links (`byGame()`, a view's `findById()`) or ranked games without their ratings (`searchAll()`).
- 8cecbf7: `webhookHandler` checks the `X-Secret` header before reading the body, and stops reading past `maxBodyBytes` (a new option, 1 MB by default) to answer 413. `igdbProxy` calls `authorize` before reading the body, and answers 413 instead of 400 as soon as a body passes its `maxBodyBytes`; the browser client splits its batch on it.

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
