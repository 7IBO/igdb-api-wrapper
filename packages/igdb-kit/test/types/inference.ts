// Compile-time tests: `tsc -p test/types` fails if an inferred type drifts.
import { createIGDB, ExternalGameSource, GameType, Platform, PopularityType } from "../../src";
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
// Timestamp fields accept a Date, at any depth; other numbers do not.
igdb.games.where((g) => g.first_release_date.gte(new Date()));
igdb.games.where((g) => g.release_dates.date.lt(new Date(2030, 0, 1)));
igdb.games.where((g) => g.first_release_date.gte(1_700_000_000));
// @ts-expect-error rating is not a timestamp
igdb.games.where((g) => g.rating.gte(new Date()));
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

// popular() keeps the selection and adds the score; only on games.
const popular = await igdb.games.select("name").popular(PopularityType.IGDBPlaying);
expectType<Equal<typeof popular, { game: { id: number; name?: string }; value: number }[]>>();
// @ts-expect-error only on games
igdb.platforms.popular(PopularityType.IGDBPlaying);

// findByExternalIds() maps store ids to games with the selection; only on games.
const bySteamId = await igdb.games.select("name").findByExternalIds(ExternalGameSource.Steam, ["292030"]);
expectType<Equal<typeof bySteamId, Map<string, { id: number; name?: string }>>>();
// @ts-expect-error only on games
igdb.platforms.findByExternalIds(ExternalGameSource.Steam, ["1"]);

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
  ageRating,
  companies,
  languages,
  localizedName,
  multiplayer,
  parentGame,
  releaseDate,
  storeLinks,
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
if (release) expectType<Equal<typeof release.row.human, string | undefined>>();
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

const ttb = await igdb.game_time_to_beats.select("hastily", "normally", "completely", "count").first();
timeToBeat(ttb);
// @ts-expect-error count is not selected
timeToBeat(await igdb.game_time_to_beats.select("hastily", "normally", "completely").first());
