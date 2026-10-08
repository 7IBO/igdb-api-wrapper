// Compile-time tests: `tsc -p test/types` fails if an inferred type drifts.
import { createIGDB, GameCategoryEnum } from "../../src";
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
  expectType<Equal<typeof q4.category, GameCategoryEnum | undefined>>();
}

// Terminals.
expectType<Equal<Awaited<ReturnType<typeof q1.first>>, R1 | null>>();
expectType<Equal<Awaited<ReturnType<typeof q1.findById>>, R1 | null>>();
expectType<Equal<Awaited<ReturnType<typeof q1.findByIds>>, R1[]>>();
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
igdb.games.where((g) => g.category.eq(GameCategoryEnum.DLC_ADDON));
// @ts-expect-error string compared to a number
igdb.games.where((g) => g.rating.gte("80"));
// @ts-expect-error gt does not exist on strings
igdb.games.where((g) => g.name.gt(1));
// @ts-expect-error 99 is not a GameCategoryEnum value
igdb.games.where((g) => g.category.eq(99));
// @ts-expect-error unknown field
igdb.games.where((g) => g.nope.eq(1));

// Every endpoint, including the newest ones, is on the client.
igdb.executables.select("*");
igdb.logos.select("*");
igdb.popularity_primitives.select("value", "popularity_type.name");
