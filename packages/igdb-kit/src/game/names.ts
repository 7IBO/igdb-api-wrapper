import { Region } from "../generated/schema";
import {
  type AlternativeNameFields,
  type AlternativeNameVariant,
  parseAlternativeName,
} from "./alternative-names";
import { parseLocale, resolveLocale } from "./locale";
import { type ItemOf, idOf, type Requires, type RequiresIfSelected } from "./select";

/** Fields of `game_localizations` that {@link localizedName} reads when they are selected. */
export type LocalizationFields = "game_localizations.name" | "game_localizations.region";
/** Fields that {@link localizedCover} reads. */
export type LocalizedCoverFields =
  | "cover.image_id"
  | "game_localizations.region"
  | "game_localizations.cover.image_id";
export type { AlternativeNameFields };

interface LocalizationRow {
  name?: string | undefined;
  region?: number | { id: number } | undefined;
  cover?: number | { id: number; image_id?: string | undefined } | undefined;
}

interface AlternativeNameRow {
  name?: string | undefined;
  comment?: string | undefined;
}

/** A game whose selection lets {@link localizedName} work. */
export interface LocalizedNameInput {
  name?: string | undefined;
  game_localizations?: readonly LocalizationRow[] | undefined;
  alternative_names?: readonly AlternativeNameRow[] | undefined;
}

type LocalizedNameRequires<G> = Requires<G, "name"> &
  RequiresIfSelected<G, "game_localizations", LocalizationFields> &
  RequiresIfSelected<G, "alternative_names", AlternativeNameFields>;

export interface LocalizedName {
  name: string;
  /**
   * Where the name comes from: the game's localization for the locale's language (`ja-JP`,
   * `ko-KR`), an alternative name in the locale's language ("Japanese title", "Chinese title -
   * traditional", "UK title" for `en-GB`), the European localization for a European locale, or the
   * game's own name.
   */
  source: "localization" | "alternative_name" | "name";
  /**
   * The language of the name as far as IGDB says: `"ja-JP"` or `"ko-KR"` for a localization, the
   * language of an alternative name's comment (`"pl"`, `"zh-Hant"`, `"en-GB"`). Null for the European
   * localization and the game's own name.
   */
  language: string | null;
  /** The variant an alternative name's comment gives (`"original"`, `"stylized"`), else null. */
  variant: AlternativeNameVariant | null;
}

const regionLanguages: Record<number, string> = { [Region.Korea]: "ko-KR", [Region.Japan]: "ja-JP" };

/**
 * The localization of a game for a locale (`ja-JP`, `ko`, `en-GB`): the one of its language
 * (Japan, Korea), else Europe for a European country. It can have no `name` (8% of them only carry a
 * regional `cover`). Null when there is none, as for 89% of games.
 */
export function localization<G extends object>(
  game: G & Requires<G, LocalizationFields>,
  locale: string,
): ItemOf<G, "game_localizations"> | null {
  const rows = (game as LocalizedNameInput).game_localizations ?? [];
  for (const region of resolveLocale(locale).localizationRegions) {
    const row = rows.find((r) => idOf(r.region) === region);
    if (row) return row as ItemOf<G, "game_localizations">;
  }
  return null;
}

/**
 * The name of a game for a locale (`ja-JP`, `zh-TW`, `fr-FR`), with fallbacks: the localization of
 * the locale's language, then an alternative name in its language (read from IGDB's free-text
 * `comment` by {@link parseAlternativeName}), then the European localization for a European country,
 * then `name`. Null only when the game has no name in the selection.
 *
 * Alternative names are checked against the script of their language: a "Japanese title" in Latin
 * letters (28% of those without a variant are romanizations) is skipped for Japanese, as are Latin
 * names for Chinese, Korean, Russian, Greek, Arabic, Hebrew, Thai or Hindi. Only a name marked
 * "original" is trusted as is, since some official titles are in Latin letters ("BIOHAZARD").
 * Romanizations, abbreviations, unofficial, working and former titles are skipped, and so are
 * translations, unless written in the language's own script ("Korean title - translated" is usually
 * in hangul, "Japanese title - translated" in English).
 *
 * ```ts
 * const game = await igdb.games.select("name", "game_localizations.name", "game_localizations.region",
 *   "alternative_names.name", "alternative_names.comment").findByIdOrThrow(1942);
 * localizedName(game, "ja-JP"); // { name: "ウィッチャー3 ワイルドハント", source: "localization", language: "ja-JP", variant: null }
 * localizedName(game, "pl-PL"); // { name: "Wiedźmin 3: Dziki Gon", source: "alternative_name", language: "pl", variant: null }
 * ```
 */
export function localizedName<G extends object>(
  game: G & LocalizedNameRequires<G>,
  locale: string,
): LocalizedName | null {
  const input = game as LocalizedNameInput;
  const resolved = resolveLocale(locale);
  const rows = input.game_localizations ?? [];
  const named = (region: number) => rows.find((r) => idOf(r.region) === region && r.name?.trim());
  const regions = resolved.localizationRegions;
  const own = regions.filter((region) => region !== Region.Europe);
  for (const region of own) {
    const row = named(region);
    if (row?.name)
      return {
        name: row.name.trim(),
        source: "localization",
        language: regionLanguages[region] ?? null,
        variant: null,
      };
  }
  const alternative = alternativeName(input.alternative_names ?? [], resolved);
  if (alternative) return { ...alternative, source: "alternative_name" };
  if (regions.includes(Region.Europe)) {
    const row = named(Region.Europe);
    if (row?.name) return { name: row.name.trim(), source: "localization", language: null, variant: null };
  }
  return input.name ? { name: input.name, source: "name", language: null, variant: null } : null;
}

/** A cover to show for a locale, from {@link localizedCover}. */
export interface LocalizedCover {
  /** The cover's `image_id`, for `imageUrl()`. */
  image_id: string;
  /** The localization's own cover (Japanese, Korean or European box art), or the game's `cover`. */
  source: "localization" | "cover";
  /** `Region` id of the localization, null for the game's cover. */
  region: number | null;
}

/**
 * The cover to show for a locale: the localization's cover for the locale's language (the Japanese
 * or Korean box art), then the European one for a European country, then the game's `cover`. Null
 * when there is none. A regional cover belongs to its localization, not to the game, so a query of
 * `covers` by game misses it.
 *
 * ```ts
 * const game = await igdb.games.select("cover.image_id", "game_localizations.region",
 *   "game_localizations.cover.image_id").findByIdOrThrow(1942);
 * imageUrl(localizedCover(game, "ja-JP")?.image_id, "cover_big");
 * ```
 */
export function localizedCover<G extends object>(
  game: G & Requires<G, LocalizedCoverFields>,
  locale: string,
): LocalizedCover | null {
  const input = game as { cover?: LocalizationRow["cover"]; game_localizations?: readonly LocalizationRow[] };
  for (const region of resolveLocale(locale).localizationRegions) {
    const row = input.game_localizations?.find((r) => idOf(r.region) === region && imageIdOf(r.cover));
    const imageId = imageIdOf(row?.cover);
    if (imageId) return { image_id: imageId, source: "localization", region };
  }
  const imageId = imageIdOf(input.cover);
  return imageId ? { image_id: imageId, source: "cover", region: null } : null;
}

function imageIdOf(cover: LocalizationRow["cover"]): string | undefined {
  return typeof cover === "object" ? cover.image_id || undefined : undefined;
}

// Scripts of the languages that are not written in Latin letters. A name is only taken for these
// languages when it has at least one letter of the script.
const scripts: Record<string, RegExp> = {
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: /\p{Script=Han}/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  uk: /\p{Script=Cyrillic}/u,
  bg: /\p{Script=Cyrillic}/u,
  be: /\p{Script=Cyrillic}/u,
  mk: /\p{Script=Cyrillic}/u,
  el: /\p{Script=Greek}/u,
  he: /\p{Script=Hebrew}/u,
  ar: /\p{Script=Arabic}/u,
  fa: /\p{Script=Arabic}/u,
  th: /\p{Script=Thai}/u,
  hi: /\p{Script=Devanagari}/u,
};
const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Lower is better; undefined for names that are not titles in the language. */
const variantRanks: Partial<Record<AlternativeNameVariant | "none", number>> = {
  original: 0,
  none: 1,
  stylized: 2,
  translated: 3,
  alternative: 4,
  spelling: 4,
};

/** The best alternative name in the locale's language. */
function alternativeName(
  rows: readonly AlternativeNameRow[],
  locale: ReturnType<typeof resolveLocale>,
): Omit<LocalizedName, "source"> | undefined {
  let best:
    | { name: string; language: string; variant: AlternativeNameVariant | null; rank: number }
    | undefined;
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;
    const { kind, language, variant } = parseAlternativeName(row.comment);
    if ((kind !== "language" && kind !== "regional") || language === null) continue;
    const tag = parseLocale(language);
    if (tag.language !== locale.language) continue;
    let rank = variantRanks[variant ?? "none"];
    if (rank === undefined) continue;
    const script = scripts[tag.language];
    if (script && variant !== "original") {
      if (!script.test(name) || (tag.language === "zh" && kana.test(name))) continue;
    } else if (variant === "translated") continue;
    if (tag.language === "zh") {
      // Chinese is told apart by script: "zh-TW" (Taiwanese) is Traditional, for Hong Kong too.
      if (!/-(?:Hans|Hant|TW)$/.test(language)) rank += 0.5;
      else if (tag.script !== locale.script) rank += 3;
    } else if (kind === "regional") {
      // A market's title only in that market: "North American title" for the US and Canada.
      if (resolveLocale(language).releaseRegion !== locale.releaseRegion) continue;
    } else if (/-(?:[A-Z]{2}|\d{3})$/.test(language)) {
      // A country's title first in that country, then for others that speak its language.
      if (tag.country !== locale.country) rank += 2;
    } else rank += 0.25; // "Brazilian title" over "Portuguese title" in Brazil.
    if (!best || rank < best.rank) best = { name, language, variant, rank };
  }
  return best && { name: best.name, language: best.language, variant: best.variant };
}
