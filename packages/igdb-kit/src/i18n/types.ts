import type {
  ArtworkType,
  CharacterGender,
  CharacterSpecie,
  CollectionMembershipType,
  CollectionRelationType,
  CollectionType,
  CompanySize,
  CompanyStatus,
  CompanyType,
  GameMode,
  GameReleaseFormat,
  GameStatus,
  GameType,
  Genre,
  ImageType,
  LanguageSupportType,
  NetworkType,
  PlatformType,
  PlayerPerspective,
  PopularityType,
  Region,
  ReleaseDateRegion,
  ReleaseDateStatus,
  Theme,
  WebsiteType,
} from "../generated/schema";

type Ids<E> = E[keyof E];

/** The ids each table with labels takes, by IGDB endpoint name. */
export interface LabelIds {
  genres: Ids<typeof Genre>;
  themes: Ids<typeof Theme>;
  game_modes: Ids<typeof GameMode>;
  player_perspectives: Ids<typeof PlayerPerspective>;
  game_types: Ids<typeof GameType>;
  game_statuses: Ids<typeof GameStatus>;
  game_release_formats: Ids<typeof GameReleaseFormat>;
  platform_types: Ids<typeof PlatformType>;
  release_date_statuses: Ids<typeof ReleaseDateStatus>;
  release_date_regions: Ids<typeof ReleaseDateRegion>;
  regions: Ids<typeof Region>;
  website_types: Ids<typeof WebsiteType>;
  language_support_types: Ids<typeof LanguageSupportType>;
  popularity_types: Ids<typeof PopularityType>;
  character_genders: Ids<typeof CharacterGender>;
  character_species: Ids<typeof CharacterSpecie>;
  company_statuses: Ids<typeof CompanyStatus>;
  company_sizes: Ids<typeof CompanySize>;
  company_types: Ids<typeof CompanyType>;
  network_types: Ids<typeof NetworkType>;
  collection_types: Ids<typeof CollectionType>;
  collection_membership_types: Ids<typeof CollectionMembershipType>;
  collection_relation_types: Ids<typeof CollectionRelationType>;
  image_types: Ids<typeof ImageType>;
  artwork_types: Ids<typeof ArtworkType>;
  /** Content and interactive element types of the descriptors: 1 content, 2 interactive element. */
  age_rating_content_description_types: number;
  /** The 97 descriptors of the ESRB, PEGI, CERO, GRAC and ClassInd ("Blood and Gore", "Fear"). */
  age_rating_content_descriptions_v2: number;
}

/** A table {@link createLabels} has labels for. */
export type LabelTable = keyof LabelIds;

/** A table {@link createLabels} also has descriptions for. */
export type DescribedTable =
  | "release_date_statuses"
  | "collection_types"
  | "collection_membership_types"
  | "collection_relation_types";

type Texts<T extends LabelTable> = { readonly [Id in LabelIds[T]]?: string };

/**
 * The labels of one language. igdb-kit has `en` built in and one entry point per language
 * (`igdb-kit/i18n/fr`); write your own for another language, or to change some labels: a table
 * or an id it leaves out falls back to the next dictionary, then to English.
 */
export interface LabelDictionary {
  /** BCP 47 tag of the language: `"fr"`, `"pt-BR"`, `"zh-CN"`. */
  locale: string;
  labels: { readonly [T in LabelTable]?: Texts<T> };
  descriptions?: { readonly [T in DescribedTable]?: Texts<T> } | undefined;
}

/** A row as IGDB returns it: its `id` and, for an id this version has no label for, its own label. */
export interface LabelRow {
  id?: number | undefined;
  name?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
  format?: string | undefined;
  region?: string | undefined;
  description?: string | undefined;
}

export interface LabelEntry {
  id: number;
  label: string;
}

export interface Labels {
  /**
   * The label of a row in the user's language, from its id or from the row itself:
   * `label("genres", 12, "fr-FR")` is "Jeu de rôle (RPG)". English when no dictionary has it, the
   * row's own label for an id added to IGDB after this version, null for an unknown id without one.
   */
  label<T extends LabelTable>(
    table: T,
    row: LabelIds[T] | number | LabelRow | null | undefined,
    locale: string,
  ): string | null;
  /** The description of a release status or collection type, as {@link Labels.label} does labels. */
  description<T extends DescribedTable>(
    table: T,
    row: LabelIds[T] | number | LabelRow | null | undefined,
    locale: string,
  ): string | null;
  /** Every id of a table with its label, in IGDB's id order: the options of a filter. */
  entries(table: LabelTable, locale: string): LabelEntry[];
}
