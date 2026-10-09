# igdb-kit

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
