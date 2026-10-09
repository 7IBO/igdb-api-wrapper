export { type BatcherOptions, MAX_BLOCKS } from "./batch/batcher";
export { type CacheStore, type MemoryCacheOptions, memoryCache } from "./cache";
export {
  type BatchResult,
  createIGDB,
  type IGDBClient,
  type IGDBClientOptions,
  type IGDBProxyClientOptions,
  type IGDBServerClientOptions,
} from "./client";
export { memoryTokenStore, type StoredToken, type TokenStore } from "./core/auth";
export * from "./core/errors";
export {
  type AcquireOptions,
  type Limiter,
  LocalLimiter,
  type LocalLimiterOptions,
  type Priority,
  sharedLimiter,
} from "./core/limiter";
export type { TransportHooks } from "./core/transport";
export * from "./generated/schema";
export {
  type ArtworkTypeFields,
  artworkType,
  type ImageSize,
  type ImageUrlOptions,
  imageSrcSet,
  imageUrl,
} from "./images";
export { type GameLinkedEndpoint, type GameLinkField, gameLink, type LinkField } from "./links/by-game";
export { type Expanded, type IdKeys, REFERENCE_ENDPOINTS, REFERENCE_TTL_MS } from "./links/expand";
export { defineSelection, type ResultOf, type Selection } from "./links/selection";
export { type NoGameFields, View, type ViewLinks, type ViewRow } from "./links/view";
export { type DateInput, toDate, toUnix } from "./query/dates";
export type {
  PopularitySnapshotOptions,
  PopularitySnapshotRow,
  PopularityWeights,
  WeightedPopular,
  WeightedPopularOptions,
} from "./query/popularity";
export {
  Count,
  Executable,
  type ExecuteOptions,
  GameLinkedQuery,
  GamesQuery,
  MAX_LIMIT,
  type PopularOptions,
  Query,
  type QueryOf,
  type QueryRequest,
  Single,
  SingleOrThrow,
  type SyncOptions,
  WithCount,
} from "./query/query";
export type {
  CatalogGame,
  CatalogOptions,
  CompanyRole,
  GameFamily,
  SeriesGame,
  SeriesOptions,
} from "./query/related";
export type {
  CalendarRelease,
  ReleaseCalendarEntry,
  ReleaseDetails,
  ReleaseFilter,
  ReleasePrecision,
  ReleasesOptions,
} from "./query/releases";
export {
  MAIN_GAME_TYPES,
  SEARCH_GAME_TYPES,
  SEARCH_KINDS,
  type SearchAll,
  type SearchAllOptions,
  type SearchHit,
  type SearchKind,
} from "./query/search-all";
export { Task } from "./query/task";
export type {
  ExcludePath,
  ExcludeResult,
  FieldPath,
  ScalarPath,
  SelectResult,
  TimestampKeys,
} from "./query/types";
export {
  type ArrayFilter,
  and,
  type BooleanFilter,
  Condition,
  type GameFilters,
  type LanguageSupportKind,
  type MainGamesOptions,
  type NamedFilter,
  type NumberFilter,
  or,
  type PlayableTogetherOptions,
  type ReleasedInOptions,
  type StringFilter,
  type TimestampFilter,
  type WhereFields,
  type WhereRoot,
} from "./query/where";
export {
  type EnsureWebhooksOptions,
  type RegisterWebhookOptions,
  type Webhook,
  type WebhookOperation,
  Webhooks,
} from "./webhooks/api";
