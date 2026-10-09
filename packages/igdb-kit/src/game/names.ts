import { europeanCountries, parseLocale } from "./locale";
import { type ItemOf, idOf, type Requires, type RequiresIfSelected } from "./select";

/** Fields of `game_localizations` that {@link localizedName} reads when they are selected. */
export type LocalizationFields = "game_localizations.name" | "game_localizations.region";
/** Fields of `alternative_names` that {@link localizedName} reads when they are selected. */
export type AlternativeNameFields = "alternative_names.name" | "alternative_names.comment";

interface LocalizationRow {
  name?: string | undefined;
  region?: number | { id: number; identifier?: string | undefined } | undefined;
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
   * Where the name comes from: the game's localization for the locale's region (`ja-JP`, `ko-KR`),
   * an alternative name in the locale's language ("Japanese title", "Chinese title - traditional"),
   * the European localization for a European locale, or the game's own name.
   */
  source: "localization" | "alternative_name" | "name";
}

// `regions` has three rows; `region` is matched on its identifier when expanded.
const regionIdentifiers: Record<number, string> = { 2: "ko-KR", 3: "ja-JP", 4: "EU" };

/**
 * The localization of a game for a locale (`ja-JP`, `ko`, `en-GB`): the one of its region (Japan,
 * Korea), else Europe for a European country. It can have no `name` (8% of them only carry a
 * regional `cover`). Null when there is none, as for 89% of games.
 */
export function localization<G extends object>(
  game: G & Requires<G, LocalizationFields>,
  locale: string,
): ItemOf<G, "game_localizations"> | null {
  const rows = (game as LocalizedNameInput).game_localizations ?? [];
  return (findLocalization(rows, locale, "locale") ??
    findLocalization(rows, locale, "continent") ??
    null) as ItemOf<G, "game_localizations"> | null;
}

/**
 * The name of a game for a locale (`ja-JP`, `zh-TW`, `fr-FR`), with fallbacks: the localization of
 * the locale's region, then an alternative name in its language (IGDB's free-text `comment`, such
 * as "Japanese title" or "Chinese title - simplified"; romanizations and translations are skipped),
 * then the European localization for a European country, then `name`. Null only when the game has
 * no name in the selection.
 *
 * ```ts
 * const game = await igdb.games.select("name", "game_localizations.name", "game_localizations.region",
 *   "alternative_names.name", "alternative_names.comment").findByIdOrThrow(1942);
 * localizedName(game, "ja-JP"); // { name: "ウィッチャー3 ワイルドハント", source: "localization" }
 * localizedName(game, "pl-PL"); // { name: "Wiedźmin 3: Dziki Gon", source: "alternative_name" }
 * ```
 */
export function localizedName<G extends object>(
  game: G & LocalizedNameRequires<G>,
  locale: string,
): LocalizedName | null {
  const input = game as LocalizedNameInput;
  const regional = findLocalization(input.game_localizations ?? [], locale, "locale", true);
  if (regional?.name) return { name: regional.name.trim(), source: "localization" };
  const alternative = alternativeName(input.alternative_names ?? [], locale);
  if (alternative) return { name: alternative, source: "alternative_name" };
  const continental = findLocalization(input.game_localizations ?? [], locale, "continent", true);
  if (continental?.name) return { name: continental.name.trim(), source: "localization" };
  return input.name ? { name: input.name, source: "name" } : null;
}

function findLocalization(
  rows: readonly LocalizationRow[],
  locale: string,
  kind: "locale" | "continent",
  named = false,
): LocalizationRow | undefined {
  const { language, country } = parseLocale(locale);
  return rows.find((row) => {
    if (named && !row.name?.trim()) return false;
    const identifier =
      (typeof row.region === "object" ? row.region.identifier : undefined) ??
      regionIdentifiers[idOf(row.region) ?? 0];
    if (!identifier) return false;
    if (kind === "continent")
      return identifier === "EU" && country !== undefined && europeanCountries.has(country);
    return identifier.includes("-") && parseLocale(identifier).language === language;
  });
}

/**
 * Picks an alternative name whose comment names the locale's language. Comments are free text:
 * "Japanese title", "Japanese title - original", "Russian Title", "German", "Chinese title - simplified".
 */
function alternativeName(rows: readonly AlternativeNameRow[], locale: string): string | undefined {
  const { language, country, script } = parseLocale(locale);
  const languageName = englishName(language);
  if (!languageName) return undefined;
  const traditional =
    script === "hant" || (script === undefined && ["TW", "HK", "MO"].includes(country ?? ""));
  let best: { name: string; rank: number } | undefined;
  for (const row of rows) {
    const match = /^\s*([a-z]+)(?:\s+title)?(?:\s*-\s*(.+?))?\s*$/i.exec(row.comment ?? "");
    const name = row.name?.trim();
    if (!match || !name || match[1]?.toLowerCase() !== languageName) continue;
    const rank = variantRank(match[2]?.toLowerCase(), traditional);
    if (rank !== undefined && (!best || rank < best.rank)) best = { name, rank };
  }
  return best?.name;
}

/** Lower is better; undefined for names that are not in the language (romanization, translation). */
function variantRank(variant: string | undefined, traditional: boolean): number | undefined {
  switch (variant) {
    case "original":
      return 0;
    case "simplified":
      return traditional ? 3 : 0;
    case "traditional":
      return traditional ? 0 : 3;
    case undefined:
      return 1;
    case "stylized":
      return 2;
    case "alternative":
    case "alternative title":
    case "unofficial":
      return 4;
    default:
      return undefined;
  }
}

let displayNames: Intl.DisplayNames | undefined;

/** "japanese" for "ja": the first word of the language's English name. */
function englishName(language: string): string | undefined {
  try {
    displayNames ??= new Intl.DisplayNames(["en"], { type: "language" });
    const name = displayNames.of(language);
    return name && name !== language ? name.split(/[\s(]/)[0]?.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}
