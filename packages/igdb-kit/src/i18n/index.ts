import { parseLocale } from "../game/locale";
import { en } from "./en";
import type { LabelDictionary, LabelEntry, LabelRow, Labels, LabelTable } from "./types";

export { en } from "./en";
export type {
  DescribedTable,
  LabelDictionary,
  LabelEntry,
  LabelIds,
  LabelRow,
  Labels,
  LabelTable,
} from "./types";

// The field holding a row's own label, when it is not `name`.
const labelFields: Partial<Record<LabelTable, keyof LabelRow>> = {
  game_types: "type",
  game_statuses: "status",
  game_release_formats: "format",
  release_date_regions: "region",
  website_types: "type",
  age_rating_content_descriptions_v2: "description",
};

type Texts = Partial<Record<string, Partial<Record<number, string>>>>;

/**
 * Labels of IGDB's reference tables in the user's language: genres, themes, game modes, player
 * perspectives, game types and statuses, release statuses and regions, website types, popularity
 * types, company sizes, image types, the age rating descriptors... IGDB has them in English only.
 *
 * English is built in. Each other language is an entry point, so an app ships only the languages
 * it imports: `igdb-kit/i18n/fr`, `de`, `es`, `pt-BR`, `pl`, `ru`, `ja` and `zh-CN`. A locale uses
 * the dictionaries of its language and script (`fr-CA` uses `fr`, `pt-PT` uses `pt-BR`, `zh-TW`
 * none of `zh-CN`), the one of its country first, then English.
 *
 * ```ts
 * import { createLabels } from "igdb-kit/i18n";
 * import { fr } from "igdb-kit/i18n/fr";
 * import { ja } from "igdb-kit/i18n/ja";
 *
 * const { label, entries } = createLabels([fr, ja]);
 * label("genres", Genre.RolePlayingRPG, "fr-FR"); // "Jeu de rôle (RPG)"
 * game.genres.map((genre) => label("genres", genre, locale)); // ids or rows
 * entries("themes", "ja"); // [{ id: 1, label: "アクション" }, ...]
 * ```
 */
export function createLabels(dictionaries: readonly LabelDictionary[] = []): Labels {
  const chains = new Map<string, LabelDictionary[]>();
  const chainOf = (locale: string) => {
    let chain = chains.get(locale);
    if (!chain) {
      chain = rank(dictionaries, locale);
      chains.set(locale, chain);
    }
    return chain;
  };

  const find = (
    kind: "labels" | "descriptions",
    table: LabelTable,
    row: number | LabelRow | null | undefined,
    locale: string,
  ): string | null => {
    if (row === null || row === undefined) return null;
    const id = typeof row === "number" ? row : row.id;
    if (id !== undefined) {
      for (const dictionary of chainOf(locale)) {
        const text = (dictionary[kind] as Texts | undefined)?.[table]?.[id];
        if (text !== undefined) return text;
      }
    }
    if (typeof row === "number") return null;
    // An id added to IGDB after this version: the row's own label, in English.
    const own = kind === "labels" ? row[labelFields[table] ?? "name"] : row.description;
    return typeof own === "string" ? own : null;
  };

  return {
    label: (table, row, locale) => find("labels", table, row, locale),
    description: (table, row, locale) => find("descriptions", table, row, locale),
    entries: (table, locale) =>
      Object.keys(en.labels[table] ?? {}).map((key): LabelEntry => {
        const id = Number(key);
        return { id, label: find("labels", table, id, locale) ?? "" };
      }),
  };
}

/** The dictionaries a locale reads, best first: its language and script, its country first, then English. */
function rank(dictionaries: readonly LabelDictionary[], locale: string): LabelDictionary[] {
  const user = parseLocale(locale);
  const matching: { dictionary: LabelDictionary; score: number; index: number }[] = [];
  const english: LabelDictionary[] = [];
  dictionaries.forEach((dictionary, index) => {
    const own = parseLocale(dictionary.locale);
    if (own.language === "en") english.push(dictionary);
    if (own.language !== user.language || own.script !== user.script) return;
    matching.push({ dictionary, score: own.country === user.country ? 0 : 1, index });
  });
  matching.sort((a, b) => a.score - b.score || a.index - b.index);
  const chain = matching.map((entry) => entry.dictionary);
  for (const dictionary of english) if (!chain.includes(dictionary)) chain.push(dictionary);
  chain.push(en);
  return chain;
}
