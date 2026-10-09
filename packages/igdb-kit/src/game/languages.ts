import { LanguageSupportType } from "../generated/schema";
import { resolveLocale } from "./locale";
import { idOf, type Ref, type Requires } from "./select";

/** Fields of `language_supports` that {@link languages} reads. */
export type LanguageFields = "language_supports.language" | "language_supports.language_support_type";

interface LanguageSupportRow {
  language?: Ref | undefined;
  language_support_type?: Ref | undefined;
}

/** A game whose selection lets {@link languages} work. */
export interface LanguagesInput {
  language_supports?: readonly LanguageSupportRow[] | undefined;
}

type LanguageOf<G> = G extends { language_supports?: readonly (infer R)[] | undefined }
  ? R extends { language?: infer L }
    ? NonNullable<L>
    : never
  : never;

export interface GameLanguage<L = Ref> {
  /** The `language` as selected: an id, or an object with `name`, `native_name`, `locale`... */
  language: L;
  /**
   * Voice-over in this language. `null` (unknown) when IGDB has no audio data at all for the game;
   * false when it lists audio for other languages only.
   */
  audio: boolean | null;
  /** Same rule as `audio`. */
  subtitles: boolean | null;
  /** Same rule as `audio`. */
  interface: boolean | null;
}

const kinds = [
  ["audio", LanguageSupportType.Audio],
  ["subtitles", LanguageSupportType.Subtitles],
  ["interface", LanguageSupportType.Interface],
] as const;

export interface LanguagesOptions {
  /** The user's locale: its languages come first (`fr-CA`: French; `en-GB`: English (UK), then English). */
  locale?: string | undefined;
}

/**
 * The languages of a game with their audio, subtitles and interface support, one entry per
 * language in IGDB's order, the user's first when `locale` is given. IGDB lists only what is supported, so a kind of support the game has
 * no data for at all is `null` rather than false: 58% of the games with language data have no
 * audio row, 51% no subtitles row. Empty when IGDB has no language data (39% of main games).
 *
 * ```ts
 * const game = await igdb.games.select("language_supports.language.native_name",
 *   "language_supports.language.locale", "language_supports.language_support_type").findByIdOrThrow(1942);
 * languages(game).filter((l) => l.audio).map((l) => l.language.native_name); // ["Polski", "Deutsch", "English (US)", ...]
 * ```
 */
export function languages<G extends object>(
  game: G & Requires<G, LanguageFields>,
  options: LanguagesOptions = {},
): GameLanguage<LanguageOf<G>>[] {
  const rows = (game as LanguagesInput).language_supports ?? [];
  return entriesOf(rows, options.locale) as GameLanguage<LanguageOf<G>>[];
}

function entriesOf(rows: readonly LanguageSupportRow[], locale: string | undefined): GameLanguage[] {
  const known = new Set(rows.map((row) => idOf(row.language_support_type)));
  const byLanguage = new Map<number, { language: Ref; types: Set<number | undefined> }>();
  for (const row of rows) {
    const id = idOf(row.language);
    // A language deleted from IGDB disappears from an expanded relation.
    if (id === undefined || row.language === undefined) continue;
    let entry = byLanguage.get(id);
    if (!entry) {
      entry = { language: row.language, types: new Set() };
      byLanguage.set(id, entry);
    }
    entry.types.add(idOf(row.language_support_type));
  }
  const entries = [...byLanguage.values()];
  if (locale !== undefined) {
    const preferred = resolveLocale(locale).languages;
    const rank = (language: Ref) => {
      const index = preferred.indexOf(idOf(language) ?? 0);
      return index === -1 ? preferred.length : index;
    };
    entries.sort((a, b) => rank(a.language) - rank(b.language));
  }
  return entries.map(({ language, types }) => {
    const result = { language } as GameLanguage;
    for (const [key, type] of kinds) result[key] = known.has(type) ? types.has(type) : null;
    return result;
  });
}

/** Whether a game is in the user's language, from {@link supportsLanguage}. */
export interface LanguageSupport {
  /**
   * The `Language` id the answer is for: the first of the locale's languages the game lists
   * (`en-GB`: English (UK), else English). Null when it lists none of them.
   */
  language: number | null;
  /**
   * Voice-over in the language. `null` (unknown) when IGDB has no audio data at all for the game,
   * as for 37% of the 1,000 most popular games with language data.
   */
  audio: boolean | null;
  /** Same rule as `audio`. */
  subtitles: boolean | null;
  /** Same rule as `audio`. */
  interface: boolean | null;
}

/**
 * Whether a game has audio, subtitles and interface in the user's language (any of the locale's
 * IGDB languages: Spanish (Spain) counts for `es-MX`). Each is `true`, `false`, or `null` when IGDB
 * has no data of that kind for the game; all three are `null` when it has no language data at all.
 *
 * ```ts
 * supportsLanguage(game, "fr-FR"); // { language: 12, audio: true, subtitles: true, interface: true }
 * ```
 */
export function supportsLanguage<G extends object>(
  game: G & Requires<G, LanguageFields>,
  locale: string,
): LanguageSupport {
  const rows = (game as LanguagesInput).language_supports ?? [];
  const known = new Set(rows.map((row) => idOf(row.language_support_type)));
  const wanted = new Set(resolveLocale(locale).languages);
  const matching = entriesOf(rows, locale).filter((entry) => wanted.has(idOf(entry.language) ?? 0));
  const support: LanguageSupport = {
    language: idOf(matching[0]?.language) ?? null,
    audio: null,
    subtitles: null,
    interface: null,
  };
  // Unknown when IGDB has no data of this kind for the game.
  for (const [key, type] of kinds) if (known.has(type)) support[key] = matching.some((entry) => entry[key]);
  return support;
}
