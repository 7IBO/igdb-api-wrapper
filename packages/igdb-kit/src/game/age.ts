import { resolveLocale } from "./locale";
import { type ItemOf, idOf, type Ref, type Requires } from "./select";

/** Fields of `age_ratings` that {@link ageRating} reads. */
export type AgeRatingFields = "age_ratings.organization" | "age_ratings.rating_category";

interface AgeRatingRow {
  organization?: Ref | undefined;
  rating_category?: number | { id: number; rating?: string | undefined } | undefined;
  synopsis?: string | undefined;
  rating_content_descriptions?: readonly { id: number; description?: string | undefined }[] | undefined;
}

// Content descriptors are read as text, so when they are selected their description must be too.
type DescriptorPath<G> = "rating_content_descriptions" extends keyof ItemOf<G, "age_ratings">
  ? "age_ratings.rating_content_descriptions.description"
  : never;

/** A game whose selection lets {@link ageRating} work. */
export interface AgeRatingInput {
  age_ratings?: readonly AgeRatingRow[] | undefined;
}

export interface GameAgeRating<R = AgeRatingRow> {
  /** `AgeRatingOrganization` id. */
  organization: number;
  /** `age_rating_categories` id. */
  category: number;
  /**
   * The rating as printed on the box: `18` (PEGI), `M` (ESRB), `MA 15+` (ACB), `Z` (CERO). `null` for
   * a category added to IGDB after this version, unless `rating_category.rating` is selected.
   */
  label: string | null;
  /**
   * The age the rating starts at: 0 for all ages, 18 for PEGI 18 or CERO Z. `null` for a rating
   * without one: pending (ESRB RP), refused classification (ACB RC), test (GRAC), parental guidance
   * (ACB PG), or a category added to IGDB after this version.
   */
  minimumAge: number | null;
  /**
   * Content descriptors (`Violence`, `In-Game Purchases`), when `rating_content_descriptions.description`
   * is selected. IGDB has them on 41% of ratings: an empty list does not mean "no sensitive content".
   */
  descriptors: string[];
  /** IGDB's free text, on about 3% of ratings (PEGI, ACB and GRAC only), when selected. */
  synopsis: string | null;
  /** The `age_ratings` row as selected. */
  row: R;
}

// The 40 rows of `age_rating_categories`: organization, label and the age the rating starts at.
const categories: Record<number, [organization: number, label: string, minimumAge: number | null]> = {
  1: [1, "RP", null],
  2: [1, "EC", 3],
  3: [1, "E", 0],
  4: [1, "E10+", 10],
  5: [1, "T", 13],
  6: [1, "M", 17],
  7: [1, "AO", 18],
  8: [2, "3", 3],
  9: [2, "7", 7],
  10: [2, "12", 12],
  11: [2, "16", 16],
  12: [2, "18", 18],
  13: [3, "A", 0],
  14: [3, "B", 12],
  15: [3, "C", 15],
  16: [3, "D", 17],
  17: [3, "Z", 18],
  18: [4, "0", 0],
  19: [4, "6", 6],
  20: [4, "12", 12],
  21: [4, "16", 16],
  22: [4, "18", 18],
  23: [5, "ALL", 0],
  24: [5, "12+", 12],
  25: [5, "15+", 15],
  26: [5, "19+", 19],
  27: [5, "TESTING", null],
  28: [6, "L", 0],
  29: [6, "10", 10],
  30: [6, "12", 12],
  31: [6, "14", 14],
  32: [6, "16", 16],
  33: [6, "18", 18],
  34: [7, "G", 0],
  35: [7, "PG", null],
  36: [7, "M", 15],
  37: [7, "MA 15+", 15],
  38: [7, "R 18+", 18],
  39: [7, "RC", null],
  40: [5, "18+", 18],
};

/**
 * The age rating a game has from one organization, or from the first of several that rated it
 * (`[AgeRatingOrganization.PEGI, AgeRatingOrganization.USK]`), or for the user's country with
 * `{ locale }`: its own organization, then ESRB and PEGI (USK, PEGI, ESRB in Germany; CERO, ESRB,
 * PEGI in Japan), which finds a rating for 53 to 55% of the 1,000 most popular games where the
 * local organization alone finds 28 to 52%. Null when none did: 79% of games have no rating at all.
 * When an organization rated a game twice, the strictest rating wins.
 *
 * ```ts
 * const game = await igdb.games.select("age_ratings.organization", "age_ratings.rating_category").findByIdOrThrow(1942);
 * ageRating(game, AgeRatingOrganization.PEGI); // { label: "18", minimumAge: 18, ... }
 * ageRating(game, { locale: "ja-JP" });          // { organization: 3, label: "Z", minimumAge: 18, ... }
 * ```
 */
export function ageRating<G extends object>(
  game: G & Requires<G, AgeRatingFields | DescriptorPath<G>>,
  organization: number | readonly number[] | { locale: string },
): GameAgeRating<ItemOf<G, "age_ratings">> | null {
  const rows = (game as AgeRatingInput).age_ratings ?? [];
  const organizations =
    typeof organization === "number"
      ? [organization]
      : "locale" in organization
        ? resolveLocale(organization.locale).ageRatingOrganizations
        : organization;
  for (const org of organizations) {
    const rating = strictest(rows, org);
    if (rating) return rating as GameAgeRating<ItemOf<G, "age_ratings">>;
  }
  return null;
}

/** Every age rating of a game, one per organization (the strictest when there are two). */
export function ageRatings<G extends object>(
  game: G & Requires<G, AgeRatingFields | DescriptorPath<G>>,
): GameAgeRating<ItemOf<G, "age_ratings">>[] {
  const rows = (game as AgeRatingInput).age_ratings ?? [];
  const organizations = new Set(rows.flatMap((row) => idOf(row.organization) ?? []));
  return [...organizations].map((org) => strictest(rows, org) as GameAgeRating<ItemOf<G, "age_ratings">>);
}

function strictest(rows: readonly AgeRatingRow[], organization: number): GameAgeRating | undefined {
  return rows
    .filter((row) => idOf(row.organization) === organization)
    .map(toAgeRating)
    .sort((a, b) => (b.minimumAge ?? -1) - (a.minimumAge ?? -1))[0];
}

function toAgeRating(row: AgeRatingRow): GameAgeRating {
  const category = idOf(row.rating_category) ?? 0;
  const known = categories[category];
  const expanded = typeof row.rating_category === "object" ? row.rating_category.rating : undefined;
  return {
    organization: idOf(row.organization) as number,
    category,
    label: expanded ?? known?.[1] ?? null,
    minimumAge: known?.[2] ?? null,
    descriptors: (row.rating_content_descriptions ?? []).flatMap((d) =>
      d.description ? [d.description] : [],
    ),
    synopsis: row.synopsis ?? null,
    row,
  };
}
