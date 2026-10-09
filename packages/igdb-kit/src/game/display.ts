import type { ReleaseDetails } from "../query/release-period";
import { alpha2 } from "./countries";
import { resolveLocale } from "./locale";
import type { Requires } from "./select";

export interface FormatReleaseDateOptions {
  /** BCP 47 locale: `"fr-FR"`, `"ja"`. */
  locale: string;
  /**
   * `"medium"` (default): "19 nov. 2026", "nov. 2026". `"long"`: "19 novembre 2026", "novembre 2026".
   * `"short"`: "19/11/2026", "11/2026". Quarters, years and TBD are the same in every style.
   */
  dateStyle?: "long" | "medium" | "short" | undefined;
  /** Your own texts, for a language igdb-kit has none for (English is the fallback). */
  labels?:
    | {
        /** "TBD", "À déterminer". */
        tbd?: string | undefined;
        /** "Q4 2026", "T4 2026". */
        quarter?: ((quarter: number, year: number) => string) | undefined;
      }
    | undefined;
}

type QuarterLabel = (quarter: number, year: number) => string;

// Quarter and TBD texts per language: `Intl` writes neither.
const englishLabels: [tbd: string, quarter: QuarterLabel] = ["TBD", (q, y) => `Q${q} ${y}`];
const releaseLabels: Record<string, [tbd: string, quarter: QuarterLabel]> = {
  en: englishLabels,
  fr: ["À déterminer", (q, y) => `T${q} ${y}`],
  de: ["Noch offen", (q, y) => `Q${q} ${y}`],
  es: ["Por determinar", (q, y) => `${q}.º trimestre de ${y}`],
  it: ["Da definire", (q, y) => `${q}° trimestre ${y}`],
  pt: ["A definir", (q, y) => `${q}º trimestre de ${y}`],
  nl: ["Nog niet bekend", (q, y) => `${q}e kwartaal ${y}`],
  pl: ["Do ustalenia", (q, y) => `${["I", "II", "III", "IV"][q - 1]} kwartał ${y}`],
  ru: ["Дата не объявлена", (q, y) => `${q}-й квартал ${y}`],
  tr: ["Belirlenecek", (q, y) => `${y} ${q}. çeyrek`],
  ja: ["未定", (q, y) => `${y}年第${q}四半期`],
  zh: ["待定", (q, y) => `${y}年第${q}季度`],
  "zh-Hant": ["待定", (q, y) => `${y}年第${q}季`],
  ko: ["미정", (q, y) => `${y}년 ${q}분기`],
};

/**
 * A release date as text in the user's language, from the `precision` that {@link releaseDate} and
 * `releases()` work out: "19 nov. 2026", "nov. 2026", "T4 2026", "2026", "À déterminer". IGDB's own
 * `human` is always in English. Days and months come from `Intl`; quarters and TBD from a short
 * table (English, French, German, Spanish, Italian, Portuguese, Dutch, Polish, Russian, Turkish,
 * Japanese, Chinese and Korean), with English for other languages unless `labels` gives them.
 *
 * ```ts
 * const release = releaseDate(game, { locale: "fr-FR" });
 * if (release) formatReleaseDate(release, { locale: "fr-FR" }); // "28 janv. 2021"
 * ```
 */
export function formatReleaseDate(
  release: Pick<ReleaseDetails, "precision" | "start" | "year" | "quarter">,
  options: FormatReleaseDateOptions,
): string {
  const { locale, dateStyle = "medium", labels } = options;
  const { language, script } = resolveLocale(locale);
  const [tbd, quarter] =
    releaseLabels[language === "zh" && script === "Hant" ? "zh-Hant" : language] ?? englishLabels;
  const { precision, start, year } = release;
  if (precision === "tbd" || !start || year === null) return labels?.tbd ?? tbd;
  if (precision === "quarter") return (labels?.quarter ?? quarter)(release.quarter ?? 1, year);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(start);
  if (precision === "day") return format({ dateStyle });
  if (precision === "month")
    return format({
      year: "numeric",
      month: dateStyle === "medium" ? "short" : dateStyle === "long" ? "long" : "2-digit",
    });
  return format({ year: "numeric" });
}

// `ReleaseDateRegion` ids as UN M.49 or ISO 3166 codes, which `Intl.DisplayNames` reads.
const releaseRegionCodes: Record<number, [code: string, english: string]> = {
  1: ["150", "Europe"],
  2: ["003", "North America"],
  3: ["AU", "Australia"],
  4: ["NZ", "New Zealand"],
  5: ["JP", "Japan"],
  6: ["CN", "China"],
  7: ["142", "Asia"],
  8: ["001", "World"],
  9: ["KR", "South Korea"],
  10: ["BR", "Brazil"],
};

/**
 * The name of a `ReleaseDateRegion` in the user's language: "Europe", "Amérique du Nord", "Japon",
 * "Monde" for worldwide. Null for an id added to IGDB after this version.
 */
export function releaseRegionName(region: number, locale: string): string | null {
  const known = releaseRegionCodes[region];
  if (!known) return null;
  return displayName("region", known[0], locale) ?? known[1];
}

/**
 * The name of a country from an ISO 3166-1 code, numeric as IGDB stores them (`companies.country`,
 * `external_games.countries`: 250) or alpha-2 (`"FR"`): "France", "Frankreich". Null when unknown.
 */
export function countryName(country: number | string, locale: string): string | null {
  const letters = typeof country === "number" ? alpha2(country) : country.toUpperCase();
  if (!letters || !/^[A-Z]{2}$/.test(letters)) return null;
  return displayName("region", letters, locale);
}

// Tags of IGDB's 28 `languages` that name them best: "Chinese (Simplified)" is `zh-Hans`, "Spanish
// (Mexico)" stands for Latin American Spanish, and "Norwegian" is not only Bokmål.
const languageTags: Record<number, string> = {
  1: "ar",
  2: "zh-Hans",
  3: "zh-Hant",
  4: "cs",
  5: "da",
  6: "nl",
  7: "en-US",
  8: "en-GB",
  9: "es-ES",
  10: "es-419",
  11: "fi",
  12: "fr",
  13: "he",
  14: "hu",
  15: "it",
  16: "ja",
  17: "ko",
  18: "no",
  19: "pl",
  20: "pt-PT",
  21: "pt-BR",
  22: "ru",
  23: "sv",
  24: "tr",
  25: "th",
  26: "vi",
  27: "de",
  28: "uk",
};

const igdbLocales: Record<string, number> = {
  "zh-CN": 2,
  "zh-TW": 3,
  "en-US": 7,
  "en-GB": 8,
  "es-ES": 9,
  "es-MX": 10,
  "nb-NO": 18,
  "pt-PT": 20,
  "pt-BR": 21,
};

export interface LanguageNameOptions {
  /** The language's name in itself ("Deutsch", "日本語") rather than in `locale`. */
  native?: boolean | undefined;
}

/**
 * The name of a language in the user's language: "français", "anglais britannique", "chinois
 * simplifié". Takes a `Language` id, IGDB's `languages.locale` (`"zh-TW"`, `"es-MX"`) or any BCP 47
 * tag. Names are as `Intl` writes them, in lowercase in some languages. Null when unknown.
 */
export function languageName(
  language: number | string,
  locale: string,
  options: LanguageNameOptions = {},
): string | null {
  const tag =
    typeof language === "number"
      ? languageTags[language]
      : (languageTags[igdbLocales[language] ?? 0] ?? language.replace(/_/g, "-"));
  if (!tag) return null;
  return displayName("language", tag, options.native ? tag : locale);
}

const displayNames = new Map<string, Intl.DisplayNames>();

function displayName(type: "region" | "language", code: string, locale: string): string | null {
  try {
    const key = `${type} ${locale}`;
    let names = displayNames.get(key);
    if (!names) {
      names = new Intl.DisplayNames([locale, "en"], { type, fallback: "none" });
      displayNames.set(key, names);
    }
    return names.of(code) ?? null;
  } catch {
    return null;
  }
}

/** Fields of `events` that {@link eventTime} reads. */
export type EventTimeFields = "start_time" | "time_zone";

// The zones IGDB's events use, as abbreviations: Bun rejects PST, JST and CST, and EST, GMT and CET
// are fixed offsets without summer time. "CST" is ambiguous (China or US Central): US Central here.
const timeZones: Record<string, string> = {
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  JST: "Asia/Tokyo",
  CET: "Europe/Berlin",
  CEST: "Europe/Berlin",
  GMT: "Europe/London",
  BST: "Europe/London",
  UTC: "UTC",
};

export interface EventTimeOptions {
  locale: string;
  /** IANA zone to show the time in, such as the user's. Default: the event's own zone. */
  timeZone?: string | undefined;
}

export interface EventTime {
  start: Date | null;
  end: Date | null;
  /** The event's zone as an IANA name (`"America/Los_Angeles"` for IGDB's `"PST"`), null when unknown. */
  timeZone: string | null;
  /** The start in the user's language and zone: "10 juin 2026, 19:00 UTC+2". Null without a start. */
  text: string | null;
}

/**
 * When an event starts, in the user's language and time zone. IGDB stores `start_time` and
 * `end_time` in UTC and the event's zone as an abbreviation (`"PST"`, `"JST"`, `"CET"`), which is
 * turned into an IANA zone here: Bun rejects most of them.
 *
 * ```ts
 * const event = await igdb.events.select("name", "start_time", "end_time", "time_zone").findByIdOrThrow(1);
 * eventTime(event, { locale: "fr-FR", timeZone: "Europe/Paris" }).text; // "10 juin 2026, 19:00 UTC+2"
 * ```
 */
export function eventTime<E extends object>(
  event: E & Requires<E, EventTimeFields>,
  options: EventTimeOptions,
): EventTime {
  const input = event as { start_time?: number; end_time?: number; time_zone?: string };
  const start = typeof input.start_time === "number" ? new Date(input.start_time * 1000) : null;
  const end = typeof input.end_time === "number" ? new Date(input.end_time * 1000) : null;
  const timeZone = ianaZone(input.time_zone);
  let text: string | null = null;
  if (start) {
    const zone = ianaZone(options.timeZone) ?? timeZone ?? "UTC";
    text = new Intl.DateTimeFormat(options.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(start);
    const offset = new Intl.DateTimeFormat(options.locale, { timeZone: zone, timeZoneName: "short" })
      .formatToParts(start)
      .find((part) => part.type === "timeZoneName")?.value;
    if (offset) text = `${text} ${offset}`;
  }
  return { start, end, timeZone, text };
}

/** An IANA zone from an IGDB abbreviation or an IANA name; null when neither. */
function ianaZone(zone: string | undefined): string | null {
  if (!zone) return null;
  const known = timeZones[zone.trim().toUpperCase()];
  if (known) return known;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
