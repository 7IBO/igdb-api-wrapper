import { LanguageSupportType } from "../generated/schema";
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
   * Voice-over in this language. Undefined (unknown) when IGDB has no audio data at all for the
   * game; false when it lists audio for other languages only.
   */
  audio: boolean | undefined;
  /** Same rule as `audio`. */
  subtitles: boolean | undefined;
  /** Same rule as `audio`. */
  interface: boolean | undefined;
}

const kinds = [
  ["audio", LanguageSupportType.Audio],
  ["subtitles", LanguageSupportType.Subtitles],
  ["interface", LanguageSupportType.Interface],
] as const;

/**
 * The languages of a game with their audio, subtitles and interface support, one entry per
 * language in IGDB's order. IGDB lists only what is supported, so a kind of support the game has
 * no data for at all is `undefined` rather than false: 58% of the games with language data have no
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
): GameLanguage<LanguageOf<G>>[] {
  const rows = (game as LanguagesInput).language_supports ?? [];
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
  return [...byLanguage.values()].map(({ language, types }) => {
    const result = { language } as GameLanguage;
    for (const [key, type] of kinds) result[key] = known.has(type) ? types.has(type) : undefined;
    return result as GameLanguage<LanguageOf<G>>;
  });
}
