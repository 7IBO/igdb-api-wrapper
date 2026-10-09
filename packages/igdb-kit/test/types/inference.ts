// Compile-time tests: `tsc -p test/types` fails if an inferred type drifts.
import {
  createIGDB,
  defineSelection,
  ExternalGameSource,
  type GameLinkedEndpoint,
  GameType,
  Platform,
  PopularityType,
  ReleaseDateStatus,
  type ResultOf,
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

// popularitySnapshot() yields rows ready to store.
for await (const rows of igdb.popularitySnapshot({ top: 100 })) {
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

// byGame() groups rows of endpoints that point to games, by game id.
const ttbByGame = await igdb.game_time_to_beats.select("normally").byGame([1942]);
expectType<Equal<typeof ttbByGame, Map<number, { id: number; normally?: number }[]>>>();
const charactersByGame = await igdb.characters.select("name", "mug_shot.image_id").byGame([1942]);
expectType<
  Equal<
    typeof charactersByGame,
    Map<number, { id: number; name?: string; mug_shot?: { id: number; image_id?: string } }[]>
  >
>();
igdb.release_dates.byGame([1]);
igdb.collections.byGame([1]);
// @ts-expect-error genres do not point to games
igdb.genres.byGame([1]);
// @ts-expect-error the search endpoint needs a search term
igdb.search.byGame([1]);
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
