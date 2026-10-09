// Compile-time tests: `tsc -p test/types` fails if an inferred type drifts.
import {
  type AgeRatingCategory,
  and,
  artworkType,
  type CalendarRelease,
  createIGDB,
  defineSelection,
  ExternalGameSource,
  type GameLinkedEndpoint,
  type GameLinkedQuery,
  type GamesQuery,
  GameType,
  Genre,
  imageSrcSet,
  type Language,
  MAIN_GAME_TYPES,
  Platform,
  PopularityType,
  type Query,
  type QueryOf,
  type ReleaseCalendarEntry,
  ReleaseDateRegion,
  ReleaseDateStatus,
  type ResultOf,
  type SearchHit,
  type Task,
} from "../../src";
import type { Prettify } from "../../src/query/types";
import { type Equal, expectType } from "./helpers";

const igdb = createIGDB({ clientId: "x", clientSecret: "y" });

// Default: IGDB returns only ids.
type Bare = Awaited<typeof igdb.games>;
expectType<Equal<Bare, { id: number }[]>>();

// Scalars are optional (IGDB omits empty fields), relations are ids unless expanded.
const q1 = igdb.games.select("name", "rating", "genres", "cover", "first_release_date");
type R1 = Awaited<typeof q1>[number];
expectType<
  Equal<
    R1,
    {
      id: number;
      name?: string;
      rating?: number;
      genres?: number[];
      cover?: number;
      first_release_date?: number;
    }
  >
>();

// Expanded relations become nested objects, arrays stay arrays, nesting works at any depth.
const q2 = igdb.games.select("name", "cover.image_id", "platforms.name", "involved_companies.company.name");
type R2 = Awaited<typeof q2>[number];
expectType<
  Equal<
    R2,
    {
      id: number;
      name?: string;
      cover?: { id: number; image_id?: string };
      platforms?: { id: number; name?: string }[];
      involved_companies?: { id: number; company?: { id: number; name?: string } }[];
    }
  >
>();

// Selecting a relation and one of its fields expands it.
type R3 = Awaited<ReturnType<typeof igdb.games.select<"cover" | "cover.width">>>[number];
expectType<Equal<R3, { id: number; cover?: { id: number; width?: number } }>>();

// Wildcards.
const q4 = await igdb.games.select("*", "cover.*").first();
if (q4) {
  expectType<Equal<typeof q4.platforms, number[] | undefined>>();
  expectType<
    Equal<
      typeof q4.cover,
      | {
          id: number;
          alpha_channel?: boolean;
          animated?: boolean;
          checksum?: string;
          game?: number;
          game_localization?: number;
          height?: number;
          image_id?: string;
          image_type?: number;
          url?: string;
          width?: number;
        }
      | undefined
    >
  >();
  expectType<Equal<typeof q4.game_type, number | undefined>>();
  // @ts-expect-error fields IGDB replaced are not in the types
  q4.category;
}

// Each endpoint has the query class of its methods, kept through the builder.
expectType<Equal<typeof igdb.games, GamesQuery<{ id: number }>>>();
expectType<Equal<typeof igdb.release_dates, GameLinkedQuery<"release_dates", { id: number }>>>();
expectType<Equal<typeof igdb.platforms, Query<"platforms", { id: number }>>>();
expectType<Equal<QueryOf<"characters">, GameLinkedQuery<"characters", { id: number }>>>();
expectType<Equal<typeof q1, GamesQuery<R1>>>();
expectType<Equal<ReturnType<typeof q1.where>, GamesQuery<R1>>>();
igdb.games.select("name").limit(5).popular(PopularityType.IGDBVisits);
igdb.release_dates.select("date").sort("date").findByGames([1942]);
// @ts-expect-error popular() is only on games
igdb.release_dates.popular(PopularityType.IGDBVisits);
// @ts-expect-error findByGames() is only on endpoints that point to games
igdb.platforms.select("name").findByGames([1942]);

// catch() and finally() run a query like await.
const caught = await igdb.games.select("name").catch(() => null);
expectType<Equal<typeof caught, { id: number; name?: string }[] | null>>();
const counted = await igdb.games.count().finally(() => {});
expectType<Equal<typeof counted, number>>();

// Terminals.
expectType<Equal<Awaited<ReturnType<typeof q1.first>>, R1 | null>>();
expectType<Equal<Awaited<ReturnType<typeof q1.findById>>, R1 | null>>();
expectType<Equal<Awaited<ReturnType<typeof q1.findByIds>>, R1[]>>();
expectType<Equal<Awaited<ReturnType<typeof q1.findByIdOrThrow>>, R1>>();
expectType<Equal<Awaited<ReturnType<typeof q1.firstOrThrow>>, R1>>();
expectType<Equal<Awaited<ReturnType<typeof q1.count>>, number>>();
expectType<Equal<Awaited<ReturnType<typeof q1.withCount>>, { data: R1[]; total: number }>>();
for await (const g of q1.iterate()) expectType<Equal<typeof g, R1>>();

// Chaining keeps the selection.
const q5 = q2
  .where((g) => g.rating.gte(80))
  .sort("rating", "desc")
  .limit(5);
expectType<Equal<Awaited<typeof q5>[number], R2>>();

// Invalid paths are compile errors.
// @ts-expect-error unknown field
igdb.games.select("nom");
// @ts-expect-error unknown nested field
igdb.games.select("cover.nope");
// @ts-expect-error scalar is not a relation
igdb.games.select("name.length");
// @ts-expect-error wildcard on a scalar
igdb.games.select("name.*");
// @ts-expect-error sort on a relation
igdb.games.sort("cover");
// @ts-expect-error sort on an unknown field
igdb.games.sort("popularity");
// @ts-expect-error IGDB ignores sort on a relation's field
igdb.games.sort("cover.width");

// search exists only on searchable endpoints.
igdb.games.search("zelda");
igdb.characters.search("mario");
// @ts-expect-error genres is not searchable
igdb.genres.search("rpg");

// Typed where.
igdb.games.where((g) => g.name.startsWith("Super"));
igdb.games.where((g) => g.platforms.any(6, 48));
igdb.games.where((g) => g.platforms.name.eq("PC"));
igdb.games.where((g) => g.cover.image_id.eq("abc"));
igdb.games.where((g) => g.game_type.eq(GameType.MainGame).and(g.platforms.any(Platform.PlayStation5)));
// Timestamp fields accept a Date, a date string or seconds, at any depth; other numbers do not.
igdb.games.where((g) => g.first_release_date.gte(new Date()));
igdb.games.where((g) => g.release_dates.date.lt(new Date(2030, 0, 1)));
igdb.games.where((g) => g.first_release_date.gte(1_700_000_000));
igdb.games.where((g) => g.first_release_date.between("2026-01-01", "2027-01-01"));
igdb.games.where((g) => g.release_dates.date.in("2026-10-20", new Date(), 1_790_000_000));
// @ts-expect-error rating is not a timestamp
igdb.games.where((g) => g.rating.gte(new Date()));
// @ts-expect-error rating is not a timestamp
igdb.games.where((g) => g.rating.between(1, 2));
// @ts-expect-error a string is not a number
igdb.games.where((g) => g.rating.gte("2026-01-01"));
// The hidden timestamp key never shows in results.
expectType<Equal<Extract<keyof NonNullable<typeof q4>, symbol>, never>>();
// @ts-expect-error string compared to a number
igdb.games.where((g) => g.rating.gte("80"));
// @ts-expect-error gt does not exist on strings
igdb.games.where((g) => g.name.gt(1));
// @ts-expect-error fields IGDB replaced are rejected: category -> game_type
igdb.games.where((g) => g.category.eq(0));
// @ts-expect-error same in select
igdb.games.select("category");
// @ts-expect-error and in sort
igdb.release_dates.sort("region");

// exclude() removes fields from the result, nested ones included, and only accepts selected fields.
const x1 = igdb.games
  .select("name", "summary", "cover.image_id", "cover.url", "platforms.*")
  .exclude("summary", "cover.url");
type X1 = Awaited<typeof x1>[number];
expectType<Equal<X1["cover"], { id: number; image_id?: string } | undefined>>();
expectType<Equal<"summary" extends keyof X1 ? true : false, false>>();
const x2 = igdb.games.select("*", "cover.*").exclude("storyline", "cover.checksum").exclude("cover.url");
type X2 = NonNullable<Awaited<ReturnType<typeof x2.first>>>;
expectType<Equal<Extract<keyof X2, "storyline">, never>>();
expectType<Equal<Extract<keyof NonNullable<X2["cover"]>, "url" | "checksum">, never>>();
expectType<Equal<X2["name"], string | undefined>>();
const x3 = igdb.games
  .select("name", "platforms.name", "platforms.abbreviation")
  .exclude("platforms.abbreviation");
expectType<
  Equal<
    Awaited<typeof x3>[number],
    { id: number; name?: string; platforms?: { id: number; name?: string }[] }
  >
>();
// @ts-expect-error not selected
igdb.games.select("name").exclude("summary");
// @ts-expect-error IGDB always returns id
igdb.games.select("*").exclude("id");
// @ts-expect-error an expanded relation is removed from select, not excluded
igdb.games.select("cover.*").exclude("cover");
// @ts-expect-error no wildcard in exclude
igdb.games.select("cover.*").exclude("cover.*");
// @ts-expect-error cover is not expanded
igdb.games.select("*").exclude("cover.url");

// Named filters on games, usable with and()/or().
igdb.games.where((g) => and(g.developedBy(908), g.rating.gte(80)));
igdb.games.where((g) => g.publishedBy(50, 248).or(g.developedBy(908)));
igdb.games.where((g) => g.developedBy("CD Projekt RED", "Square Enix"));
// @ts-expect-error ids and names can't be mixed
igdb.games.where((g) => g.developedBy(908, "Square Enix"));
igdb.games.where((g) =>
  g.releasedIn({
    platforms: Platform.PlayStation5,
    regions: [ReleaseDateRegion.Europe, ReleaseDateRegion.Japan],
    statuses: [ReleaseDateStatus.FullRelease, null],
    from: new Date(),
    to: "2030-01-01",
  }),
);
// The deprecated names still compile.
igdb.games.where((g) => g.releasedIn({ platform: 6, region: 1, worldwide: false, includeCancelled: true }));
// @ts-expect-error statuses are ids
igdb.games.where((g) => g.releasedIn({ statuses: ["full_release"] }));
// @ts-expect-error only on games
igdb.platforms.where((p) => p.developedBy(1));
// @ts-expect-error not on nested relations
igdb.games.where((g) => g.similar_games.developedBy(1));

// searchAll() returns hits narrowed by kind, with the fields selected per kind.
const hits = await igdb.searchAll("zelda", {
  kinds: ["game", "character"],
  select: { game: ["cover.image_id", "first_release_date"], character: ["mug_shot.image_id"] },
});
for (const hit of hits) {
  expectType<Equal<typeof hit.kind, "game" | "character">>();
  expectType<Equal<typeof hit.matched, "name" | "alternative_name">>();
  if (hit.kind === "game") {
    expectType<
      Equal<
        typeof hit.game,
        { id: number; name?: string; cover?: { id: number; image_id?: string }; first_release_date?: number }
      >
    >();
  } else {
    expectType<
      Equal<typeof hit.character, { id: number; name?: string; mug_shot?: { id: number; image_id?: string } }>
    >();
  }
}
const all = await igdb.searchAll("mario");
expectType<Equal<(typeof all)[number]["kind"], "game" | "character" | "collection" | "platform" | "theme">>();
expectType<Equal<Extract<(typeof all)[number], { kind: "theme" }>["theme"], { id: number; name?: string }>>();
expectType<Equal<SearchHit<"platform">["platform"]["id"], number>>();
// @ts-expect-error unknown field of a character
igdb.searchAll("mario", { select: { character: ["nope"] } });
// @ts-expect-error companies are not in the search index
igdb.searchAll("ubisoft", { kinds: ["company"] });
// Game types: one id, several, or all; editions are kept with `includeEditions` (`editions` is deprecated).
igdb.searchAll("zelda", { gameTypes: GameType.Mod, includeEditions: true });
igdb.searchAll("zelda", { gameTypes: MAIN_GAME_TYPES, editions: true });
igdb.games.where((g) => g.game_type.in(...MAIN_GAME_TYPES));

// New reference constants.
expectType<Equal<typeof ReleaseDateStatus.Cancelled, 5>>();
expectType<Equal<typeof AgeRatingCategory.PEGI_18, 12>>();
expectType<Equal<typeof Language.French, 12>>();

// Reference constants are values and the entity types of their endpoint at once.
expectType<Equal<typeof GameType.MainGame, 0>>();
const gameType: GameType = { id: 0, type: "Main Game" } as GameType;
expectType<Equal<typeof gameType.id, number>>();
// @ts-expect-error unknown field
igdb.games.where((g) => g.nope.eq(1));

// Every endpoint, including the newest ones, is on the client.
igdb.executables.select("*");
igdb.logos.select("*");
igdb.popularity_primitives.select("value", "popularity_type.name");

// batch() keeps each result's type under its key.
const batched = await igdb.batch({
  top: igdb.games.select("name", "cover.image_id").limit(5),
  total: igdb.games.count(),
  ps5: igdb.platforms.select("name").findById(167),
});
expectType<
  Equal<
    typeof batched,
    {
      top: { id: number; name?: string; cover?: { id: number; image_id?: string } }[];
      total: number;
      ps5: { id: number; name?: string } | null;
    }
  >
>();

// batch() also takes tasks, which the methods that take several requests return, and views.
const mixed = await igdb.batch({
  byIds: igdb.games.select("name").findByIds([1, 2]),
  top: igdb.games.select("name").popular(PopularityType.IGDBPlaying),
  dates: igdb.release_dates.select("date").findByGames([1942]),
  hits: igdb.searchAll("zelda", { kinds: ["platform"] }),
});
expectType<Equal<typeof mixed.byIds, { id: number; name?: string }[]>>();
expectType<Equal<typeof mixed.top, { game: { id: number; name?: string }; value: number }[]>>();
expectType<Equal<typeof mixed.dates, Map<number, { id: number; date?: number }[]>>>();
expectType<Equal<(typeof mixed.hits)[number]["kind"], "platform">>();
// @ts-expect-error a promise has already started: batch() takes what it starts itself
igdb.batch({ started: Promise.resolve(1) });

// A task is lazy and typed as a promise of its result.
const task = igdb.games.select("name").findByIds([1]);
expectType<Equal<typeof task, Task<{ id: number; name?: string }[]>>>();
expectType<typeof task extends Promise<{ id: number; name?: string }[]> ? true : false>();
expectType<Equal<Awaited<ReturnType<typeof task.execute>>, { id: number; name?: string }[]>>();
expectType<Equal<ReturnType<typeof igdb.games.releases>, Task<ReleaseCalendarEntry<{ id: number }>[]>>>();
// Deprecated, still accepted: request options as the last argument, or among the method's options.
igdb.games.findByIds([1], { signal: AbortSignal.timeout(1000) });
igdb.games.popular(PopularityType.IGDBPlaying, { priority: "background" });
igdb.searchAll("zelda", { batch: false });

// popular() keeps the selection and adds the score; only on games.
const popular = await igdb.games.select("name").popular(PopularityType.IGDBPlaying);
expectType<Equal<typeof popular, { game: { id: number; name?: string }; value: number }[]>>();
// @ts-expect-error only on games
igdb.platforms.popular(PopularityType.IGDBPlaying);
// The query's limit and offset page the ranking.
igdb.games.limit(20).offset(20).popular(PopularityType.IGDBPlaying);

// weightedPopular() keeps the selection, adds the score and each type's value (null: no row).
const weighted = await igdb.games
  .select("name")
  .weightedPopular({ [PopularityType.IGDBWantToPlay]: 0.6, [PopularityType.IGDBPlaying]: 0.4 });
expectType<
  Equal<
    typeof weighted,
    { game: { id: number; name?: string }; score: number; values: Record<number, number | null> }[]
  >
>();
// @ts-expect-error only on games
igdb.platforms.weightedPopular({ [PopularityType.IGDBPlaying]: 1 });

// popularitySnapshot() yields rows ready to store; `top` is the deprecated name of `limit`.
igdb.popularitySnapshot({ types: PopularityType.IGDBVisits, top: 100 });
for await (const rows of igdb.popularitySnapshot({ types: [PopularityType.IGDBVisits], limit: 100 })) {
  expectType<
    Equal<
      (typeof rows)[number],
      {
        game_id: number;
        popularity_type: number;
        value: number;
        rank: number;
        calculated_at: number | null;
        external_popularity_source: number | null;
      }
    >
  >();
}

// releases() keeps the selection of the games and types each release.
const calendar = await igdb.games.select("name", "cover.image_id").releases({
  from: "2026-10-01",
  to: new Date("2026-11-01"),
  statuses: [ReleaseDateStatus.FullRelease, null],
});
expectType<
  Equal<
    (typeof calendar)[number]["game"],
    { id: number; name?: string; cover?: { id: number; image_id?: string } }
  >
>();
expectType<
  Equal<(typeof calendar)[number]["release"]["precision"], "day" | "month" | "quarter" | "year" | "tbd">
>();
expectType<Equal<(typeof calendar)[number]["release"]["start"], Date | null>>();
expectType<Equal<(typeof calendar)[number]["release"]["status"], number | null>>();
expectType<Equal<(typeof calendar)[number]["release"]["month"], number | null>>();
igdb.games.releases({ from: 1_790_000_000, to: "2026-11-01", platforms: 6, regions: 1, statuses: 6 });
// @ts-expect-error not a precision
igdb.games.releases({ from: "2026-10-01", to: "2026-11-01", precision: ["week"] });
// @ts-expect-error a window is required
igdb.games.releases({ from: "2026-10-01" });
// @ts-expect-error only on games
igdb.platforms.releases({ from: "2026-10-01", to: "2026-11-01" });

// findByExternalIds() maps store ids to games with the selection; only on games.
const bySteamId = await igdb.games.select("name").findByExternalIds(ExternalGameSource.Steam, ["292030"]);
expectType<Equal<typeof bySteamId, Map<string, { id: number; name?: string }>>>();
// @ts-expect-error only on games
igdb.platforms.findByExternalIds(ExternalGameSource.Steam, ["1"]);

// findByGames() groups rows of endpoints that point to games, by game id.
const ttbByGame = await igdb.game_time_to_beats.select("normally").findByGames([1942]);
expectType<Equal<typeof ttbByGame, Map<number, { id: number; normally?: number }[]>>>();
const charactersByGame = await igdb.characters.select("name", "mug_shot.image_id").findByGames([1942]);
expectType<
  Equal<
    typeof charactersByGame,
    Map<number, { id: number; name?: string; mug_shot?: { id: number; image_id?: string } }[]>
  >
>();
igdb.release_dates.findByGames([1]);
igdb.collections.findByGames([1]);
// @ts-expect-error genres do not point to games
igdb.genres.findByGames([1]);
// @ts-expect-error the search endpoint needs a search term
igdb.search.findByGames([1]);
// Deprecated alias, same types.
const ttbDeprecated = await igdb.game_time_to_beats.select("normally").byGame([1942]);
expectType<Equal<typeof ttbDeprecated, typeof ttbByGame>>();
// @ts-expect-error genres do not point to games
igdb.genres.byGame([1]);
expectType<
  Equal<
    Extract<GameLinkedEndpoint, "events" | "popularity_primitives" | "games">,
    "events" | "popularity_primitives"
  >
>();

// Selections are named, reusable and typed.
const gameCard = defineSelection("games", "name", "cover.image_id");
type GameCard = ResultOf<typeof gameCard>;
expectType<Equal<GameCard, { id: number; name?: string; cover?: { id: number; image_id?: string } }>>();
const withCard = igdb.games.select(...gameCard, "summary");
expectType<Equal<ResultOf<typeof withCard>, Prettify<GameCard & { summary?: string }>>>();
expectType<Equal<ResultOf<ReturnType<typeof withCard.first>>, ResultOf<typeof withCard>>>();
// @ts-expect-error unknown field
defineSelection("games", "nom");

// Views attach linked rows to games under their keys.
const gamePage = igdb.defineView("games", {
  select: [...gameCard, "summary"],
  with: {
    timeToBeat: igdb.game_time_to_beats.select("normally"),
    characters: igdb.characters.select("name"),
  },
});
type GamePage = {
  id: number;
  name?: string;
  cover?: { id: number; image_id?: string };
  summary?: string;
  timeToBeat: { id: number; normally?: number }[];
  characters: { id: number; name?: string }[];
};
expectType<Equal<Awaited<ReturnType<typeof gamePage.findById>>, GamePage | null>>();
expectType<Equal<Awaited<ReturnType<typeof gamePage.findByIds>>, GamePage[]>>();
expectType<Equal<Awaited<ReturnType<ReturnType<typeof gamePage.where>["limit"]>>, GamePage[]>>();
expectType<Equal<ResultOf<typeof gamePage>, GamePage>>();
gamePage.where((g) => g.rating.gte(90)).sort("rating", "desc");
gamePage.search("zelda");
gamePage.where((g) => g.developedBy("Nintendo"));
const pageCount = await gamePage.where((g) => g.rating.gte(90)).count();
expectType<Equal<typeof pageCount, number>>();
const pageWithCount = await gamePage.limit(20).withCount();
expectType<Equal<typeof pageWithCount, { data: GamePage[]; total: number }>>();
expectType<Equal<ReturnType<typeof gamePage.first>, Task<GamePage | null>>>();
const pageOrNull = await gamePage.limit(5).catch(() => null);
expectType<Equal<typeof pageOrNull, GamePage[] | null>>();
const viewBatch = await igdb.batch({ one: gamePage.findById(1942), list: gamePage.limit(2) });
expectType<Equal<typeof viewBatch, { one: GamePage | null; list: GamePage[] }>>();
// @ts-expect-error unknown field in a view's select
igdb.defineView("games", { select: ["nom"] });
// @ts-expect-error a key that hides a game field
igdb.defineView("games", { with: { name: igdb.characters.select("name") } });

// expand() swaps ids for the target's rows, keeping arrays and optionality.
const listed = await igdb.games.select("name", "platforms", "cover").limit(5);
const expanded = await igdb.expand(listed, "platforms", igdb.platforms.select("name"));
expectType<
  Equal<
    typeof expanded,
    { id: number; name?: string; platforms?: { id: number; name?: string }[]; cover?: number }[]
  >
>();
const withCover = await igdb.expand(listed, "cover", igdb.covers.select("image_id"));
expectType<Equal<(typeof withCover)[number]["cover"], { id: number; image_id?: string } | undefined>>();
// @ts-expect-error name holds no ids
igdb.expand(listed, "name", igdb.platforms);
// The target of expand() can be any endpoint's query, games included.
const events = await igdb.events.select("name", "games").limit(1);
const eventGames = await igdb.expand(events, "games", igdb.games.select("name"));
expectType<Equal<(typeof eventGames)[number]["games"], { id: number; name?: string }[] | undefined>>();
const expandTask = igdb.expand(listed, "platforms", igdb.platforms, { priority: "background" });
expectType<
  Equal<
    typeof expandTask,
    Task<{ id: number; name?: string; platforms?: { id: number }[]; cover?: number }[]>
  >
>();

// Webhook deliveries narrow by endpoint and operation.
import { webhookHandler } from "../../src/webhooks";

webhookHandler<"games" | "platforms">({
  secret: "s",
  onEvent: (event) => {
    if (event.endpoint === "games" && event.operation !== "delete") {
      expectType<Equal<typeof event.data.name, string | undefined>>();
      expectType<Equal<typeof event.data.cover, number | undefined>>();
    }
    if (event.operation === "delete") expectType<Equal<typeof event.data, { id: number }>>();
    // @ts-expect-error not subscribed to this endpoint
    if (event.endpoint === "genres") return;
  },
});

// A proxy client takes no credentials; a direct client needs a client id.
const viaProxy = createIGDB({ proxyUrl: "/api/igdb" });
expectType<Equal<typeof viaProxy, typeof igdb>>();
// @ts-expect-error credentials stay on the server
createIGDB({ proxyUrl: "/api/igdb", clientSecret: "s" });
// @ts-expect-error a client id is required without a proxy
createIGDB({ clientSecret: "s" });

import { igdbProxy } from "../../src/proxy";

igdbProxy({ igdb, endpoints: ["games", "covers"] });
// @ts-expect-error unknown endpoint
igdbProxy({ igdb, endpoints: ["gamez"] });

// igdb-kit/game: helpers require the fields they read and accept any richer selection.
import {
  type AlternativeNameKind,
  ageRating,
  alternativeTitles,
  companies,
  eventTime,
  formatReleaseDate,
  languages,
  localizedCover,
  localizedName,
  multiplayer,
  parentGame,
  regionalReleases,
  releaseDate,
  type resolveLocale,
  type Store,
  storeLinks,
  type storeOf,
  supportsLanguage,
  timeToBeat,
} from "../../src/game";

const page = await igdb.games
  .select(
    "name",
    "cover.image_id",
    "release_dates.*",
    "involved_companies.company.name",
    "involved_companies.developer",
    "involved_companies.publisher",
    "involved_companies.porting",
    "involved_companies.supporting",
    "websites.url",
    "websites.trusted",
    "age_ratings.organization",
    "age_ratings.rating_category.rating",
    "age_ratings.rating_content_descriptions.description",
    "language_supports.language.locale",
    "language_supports.language_support_type",
    "multiplayer_modes.*",
    "game_type",
    "parent_game.name",
    "version_parent",
  )
  .findByIdOrThrow(1942);
const release = releaseDate(page, { region: 1 });
if (release) {
  expectType<Equal<typeof release.row.human, string | undefined>>();
  expectType<Equal<typeof release.status, number | null>>();
  expectType<Equal<typeof release.start, Date | null>>();
  // A calendar release and releaseDate() share their fields.
  expectType<
    Equal<Omit<CalendarRelease, "id">, Omit<typeof release, "match" | "row" | "date" | "statusId">>
  >();
}
releaseDate(page, { locale: "fr-FR", statuses: [ReleaseDateStatus.FullRelease, null] });
releaseDate(page, { statuses: ReleaseDateStatus.FullRelease });
// @ts-expect-error not a status
releaseDate(page, { statuses: ["released"] });
expectType<Equal<ReturnType<typeof storeOf>, Store | null>>();
expectType<Equal<ReturnType<typeof companies<typeof page>>["developers"], { id: number; name?: string }[]>>();
storeLinks(page);
ageRating(page, 2);
const language = languages(page)[0];
if (language) expectType<Equal<typeof language.language, { id: number; locale?: string }>>();
expectType<Equal<ReturnType<typeof multiplayer<typeof page>>, ReturnType<typeof multiplayer>>>();
const parent = parentGame(page);
if (parent) expectType<Equal<typeof parent.game, number | { id: number; name?: string }>>();
localizedName(page, "ja-JP");

const datesOnly = await igdb.games.select("release_dates.date", "release_dates.human").findByIdOrThrow(1);
// @ts-expect-error release_dates.status, .platform... are not selected
releaseDate(datesOnly);
const dateIds = await igdb.games.select("release_dates").findByIdOrThrow(1);
// @ts-expect-error release_dates are ids, not expanded
releaseDate(dateIds);
// @ts-expect-error involved_companies is not selected
companies(datesOnly);
// @ts-expect-error neither websites nor external_games is selected
storeLinks(datesOnly);
const websitesOnly = await igdb.games.select("websites.url").findByIdOrThrow(1);
// @ts-expect-error websites.trusted is not selected
storeLinks(websitesOnly);
const descriptorIds = await igdb.games
  .select(
    "age_ratings.organization",
    "age_ratings.rating_category",
    "age_ratings.rating_content_descriptions",
  )
  .findByIdOrThrow(1);
// @ts-expect-error descriptors are read as text: select rating_content_descriptions.description
ageRating(descriptorIds, 2);
// @ts-expect-error alternative_names is selected without its comment
localizedName(await igdb.games.select("name", "alternative_names.name").findByIdOrThrow(1), "ja");
// @ts-expect-error multiplayer_modes is not expanded
multiplayer(await igdb.games.select("multiplayer_modes").findByIdOrThrow(1));

const localized = await igdb.games
  .select(
    "name",
    "cover.image_id",
    "cover.width",
    "game_localizations.region",
    "game_localizations.cover.image_id",
    "alternative_names.name",
    "alternative_names.comment",
    "alternative_names.game",
  )
  .findByIdOrThrow(1942);
expectType<Equal<ReturnType<typeof localizedCover>, import("../../src/game").LocalizedCover | null>>();
localizedCover(localized, "ja-JP");
const noRegionalCovers = await igdb.games
  .select("cover.image_id", "game_localizations.region")
  .findByIdOrThrow(1);
// @ts-expect-error the localizations' covers are not selected
localizedCover(noRegionalCovers, "ja");
const title = alternativeTitles(localized)[0];
if (title) {
  expectType<Equal<typeof title.row, { id: number; name?: string; comment?: string; game?: number }>>();
  expectType<Equal<typeof title.kind, AlternativeNameKind>>();
}
// @ts-expect-error alternative_names.comment is not selected
alternativeTitles(await igdb.games.select("alternative_names.name").findByIdOrThrow(1));
expectType<Equal<ReturnType<typeof resolveLocale>["languages"], number[]>>();

// Localized display.
if (release) formatReleaseDate(release, { locale: "fr-FR", dateStyle: "long" });
const entry = calendar[0];
if (entry) formatReleaseDate(entry.release, { locale: "fr-FR" });
regionalReleases(page, { platform: 6 })[0]?.row.human;
languages(page, { locale: "fr-FR" });
supportsLanguage(page, "fr-FR").audio satisfies boolean | null;
ageRating(page, { locale: "de-DE" });
storeLinks(page, { locale: "fr-FR", stores: ["playstation"] });
const event = await igdb.events.select("name", "start_time", "time_zone").findByIdOrThrow(1);
eventTime(event, { locale: "fr-FR", timeZone: "Europe/Paris" }).text satisfies string | null;
// @ts-expect-error time_zone is not selected
eventTime(await igdb.events.select("start_time").findByIdOrThrow(1), { locale: "fr" });

const ttb = await igdb.game_time_to_beats.select("hastily", "normally", "completely", "count").first();
timeToBeat(ttb);
timeToBeat(ttb, { prefer: ["hastily"] });
// @ts-expect-error not a kind
timeToBeat(ttb, { prefer: ["quickly"] });
// @ts-expect-error count is not selected
timeToBeat(await igdb.game_time_to_beats.select("hastily", "normally", "completely").first());

// artworkType() reads image_type and artwork_type, ids or expanded.
const artworks = await igdb.artworks
  .select("image_id", "image_type", "artwork_type.name")
  .where((a) => a.game.eq(1942));
expectType<Equal<ReturnType<typeof artworkType>, number | null>>();
for (const artwork of artworks) artworkType(artwork);
// @ts-expect-error artwork_type is not selected
artworkType(await igdb.artworks.select("image_type").findByIdOrThrow(1));

// Grouping helpers.
import {
  bestImage,
  externalId,
  externalIds,
  franchisesOf,
  groupByParent,
  platformVersions,
  relatedGameFields,
  relatedGames,
  videoLinks,
  websiteLinks,
} from "../../src/game";

const relatedIds = await igdb.games.select("name", ...relatedGameFields()).findByIdOrThrow(1942);
expectType<Equal<ReturnType<typeof relatedGames<typeof relatedIds>>["dlcs"], number[]>>();
const relatedNamed = await igdb.games
  .select(...relatedGameFields("name", "cover.image_id"))
  .findByIdOrThrow(1942);
const related = relatedGames(relatedNamed);
expectType<
  Equal<typeof related.remakes, { id: number; name?: string; cover?: { id: number; image_id?: string } }[]>
>();
if (related.parent) related.parent.game satisfies { id: number; name?: string };
expectType<
  Equal<
    ResultOf<ReturnType<typeof relatedGameFields<"name">>>["ports"],
    { id: number; name?: string }[] | undefined
  >
>();
// @ts-expect-error not a field of games
relatedGameFields("nam");
// @ts-expect-error dlcs, ports... are not selected
relatedGames(page);

const catalog = await igdb.games.select("name", "game_type", "parent_game", "version_parent").limit(10);
const { groups, missingParents } = groupByParent(catalog, { relations: ["edition", "remaster"] });
groups[0]?.members[0]?.game.name satisfies string | undefined;
missingParents satisfies number[];
// @ts-expect-error version_parent is not selected
groupByParent(await igdb.games.select("game_type", "parent_game").limit(1));
// @ts-expect-error not a relation
groupByParent(catalog, { relations: ["sequel"] });

const franchises = franchisesOf(await igdb.games.select("franchise", "franchises.name").findByIdOrThrow(1));
franchises.main satisfies number | { id: number; name?: string } | null;
// @ts-expect-error franchise is not selected
franchisesOf(await igdb.games.select("franchises").findByIdOrThrow(1));

const linked = await igdb.games
  .select(
    "external_games.external_game_source",
    "external_games.uid",
    "websites.type",
    "websites.url",
    "videos.video_id",
    "videos.name",
  )
  .findByIdOrThrow(1942);
externalId(linked, ExternalGameSource.Steam) satisfies string | null;
externalIds(linked)[0]?.url satisfies string | null | undefined;
websiteLinks(linked, { kinds: ["official", "social"] });
videoLinks(linked)[0]?.kind satisfies "trailer" | "gameplay" | "teaser" | "intro" | "other" | undefined;
// @ts-expect-error external_games.uid is not selected
externalIds(await igdb.games.select("external_games.external_game_source").findByIdOrThrow(1));
// @ts-expect-error websites.type is not selected
websiteLinks(page);
// @ts-expect-error not a kind
websiteLinks(linked, { kinds: ["blog"] });
// @ts-expect-error videos.name is not selected
videoLinks(await igdb.games.select("videos.video_id").findByIdOrThrow(1));

bestImage(page)?.image_id satisfies string | undefined;
bestImage(
  await igdb.games
    .select("artworks.image_id", "artworks.image_type", "artworks.artwork_type", "screenshots.image_id")
    .findByIdOrThrow(1),
  { prefer: "background" },
);
// @ts-expect-error the artworks' types are not selected
bestImage(await igdb.games.select("cover.image_id", "artworks.image_id").findByIdOrThrow(1));
// @ts-expect-error no image is selected
bestImage(datesOnly);
// @ts-expect-error not a preference
bestImage(page, { prefer: "logo" });
imageSrcSet(page.cover?.image_id, "cover_big") satisfies string | undefined;
imageSrcSet("co1wyy", "cover_big") satisfies string;

const consoles = await igdb.platforms
  .select(
    "name",
    "versions.name",
    "versions.platform_version_release_dates.date",
    "versions.platform_version_release_dates.date_format",
    "versions.platform_version_release_dates.release_region",
  )
  .findByIdOrThrow(48);
const version = platformVersions(consoles, { locale: "ja-JP" })[0];
if (version) {
  version.version.name satisfies string | undefined;
  version.release?.row.date satisfies number | undefined;
}
const versionDates = await igdb.platforms
  .select("versions.platform_version_release_dates.date")
  .findByIdOrThrow(48);
// @ts-expect-error the versions' release regions are not selected
platformVersions(versionDates);

// igdb-kit/i18n: tables and ids are checked, rows of any selection are accepted.
import { createLabels, type LabelDictionary } from "../../src/i18n";
import { fr } from "../../src/i18n/fr";

const { label, description, entries } = createLabels([fr]);
expectType<Equal<ReturnType<typeof label>, string | null>>();
label("genres", Genre.Adventure, "fr");
const labeled = await igdb.games.select("genres.name", "game_type.type").findByIdOrThrow(1942);
for (const genre of labeled.genres ?? []) label("genres", genre, "fr");
label("game_types", labeled.game_type, "fr");
description("release_date_statuses", 6, "fr");
entries("themes", "fr") satisfies { id: number; label: string }[];
// @ts-expect-error not a table with labels
label("platforms", 6, "fr");
// @ts-expect-error genres have no description
description("genres", 12, "fr");
({ locale: "fr", labels: { genres: { 12: "RPG" } } }) satisfies LabelDictionary;
// @ts-expect-error not a genre id
({ locale: "fr", labels: { genres: { 999: "RPG" } } }) satisfies LabelDictionary;

// Language filter and alternative titles in searchAll().
igdb.games.where((g) => g.supportsLanguage("fr-FR", "audio"));
igdb.games.where((g) => g.supportsLanguage([12, 8]));
// @ts-expect-error not a kind of support
igdb.games.where((g) => g.supportsLanguage(12, "voice"));
// @ts-expect-error a named filter of games only
igdb.platforms.where((p) => p.supportsLanguage(12));
igdb.searchAll("Wiedźmin 3", { alternativeTitles: "auto" });
// @ts-expect-error true, false or "auto"
igdb.searchAll("Wiedźmin 3", { alternativeTitles: "always" });
