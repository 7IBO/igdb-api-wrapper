import { AgeRatingOrganization, Language, Region, ReleaseDateRegion } from "../generated/schema";

/**
 * Countries whose games IGDB files under Europe: the European release region, and the European
 * localization (PAL titles).
 */
export const europeanCountries = new Set(
  "AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GI GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK".split(
    " ",
  ),
);

/** What IGDB data a locale picks: its release region, localization, age ratings and languages. */
export interface ResolvedLocale {
  /** The locale in canonical form: `"pt-BR"` for `"pt_br"`. */
  locale: string;
  /** Lowercase language code: `"fr"`. */
  language: string;
  /** Script, given or likely: `"Latn"`, `"Hant"` for `zh-TW`, `"Jpan"` for `ja`. Null when unknown. */
  script: string | null;
  /**
   * Country, given or likely: `"FR"` for `"fr"`, `"US"` for `"en"`, `"CN"` for `"zh"`. A UN M.49
   * region code when the locale has one (`"419"` for `es-419`). Null when unknown.
   */
  country: string | null;
  /**
   * `ReleaseDateRegion` id of the country: Europe for a European country, North America for the US
   * and Canada, Japan, Korea, China, Asia (Taiwan, Hong Kong, Southeast Asia), Australia, New Zealand
   * and Brazil. Null for a country IGDB has no region for.
   */
  releaseRegion: number | null;
  /**
   * `Region` ids of the game localizations for this locale, best first: the one of its language
   * (Japan for `ja`, Korea for `ko`), then Europe for a European country.
   */
  localizationRegions: number[];
  /**
   * `AgeRatingOrganization` ids, best first: the country's own (USK in Germany, PEGI in the rest of
   * Europe, ESRB in the Americas, CERO, GRAC, CLASS_IND, ACB), then ESRB and PEGI.
   */
  ageRatingOrganizations: number[];
  /**
   * `Language` ids of the locale's language, best first: `[EnglishUK, English]` for `en-GB`,
   * `[SpanishMexico, SpanishSpain]` for `es-419`. Empty when IGDB does not list the language.
   */
  languages: number[];
}

// Countries of the `ReleaseDateRegion` rows other than Europe and Worldwide.
const releaseRegions: Record<string, number> = {
  US: ReleaseDateRegion.NorthAmerica,
  CA: ReleaseDateRegion.NorthAmerica,
  JP: ReleaseDateRegion.Japan,
  KR: ReleaseDateRegion.Korea,
  CN: ReleaseDateRegion.China,
  TW: ReleaseDateRegion.Asia,
  HK: ReleaseDateRegion.Asia,
  MO: ReleaseDateRegion.Asia,
  SG: ReleaseDateRegion.Asia,
  MY: ReleaseDateRegion.Asia,
  TH: ReleaseDateRegion.Asia,
  ID: ReleaseDateRegion.Asia,
  PH: ReleaseDateRegion.Asia,
  VN: ReleaseDateRegion.Asia,
  AU: ReleaseDateRegion.Australia,
  NZ: ReleaseDateRegion.NewZealand,
  BR: ReleaseDateRegion.Brazil,
  "150": ReleaseDateRegion.Europe,
  "001": ReleaseDateRegion.Worldwide,
};

const { ESRB, PEGI, CERO, USK, GRAC, CLASSIND, ACB } = AgeRatingOrganization;

const ageRatingsByCountry: Record<string, number[]> = {
  DE: [USK, PEGI, ESRB],
  JP: [CERO, ESRB, PEGI],
  KR: [GRAC, ESRB, PEGI],
  BR: [CLASSIND, ESRB, PEGI],
  AU: [ACB, ESRB, PEGI],
  NZ: [ACB, ESRB, PEGI],
};

// The Americas, where ESRB comes before PEGI.
const americas = new Set(
  "US CA MX GT BZ SV HN NI CR PA CU DO HT JM PR TT BS BB CO VE EC PE BO CL AR UY PY GY SR 419 003 019 021".split(
    " ",
  ),
);

// Where English is closer to IGDB's "English" (American) than to "English (UK)".
const americanEnglish = new Set("US CA PR PH GU VI AS MP UM 419 003 019 021".split(" "));
// Where Spanish is closer to IGDB's "Spanish (Mexico)" than to "Spanish (Spain)".
const latinAmericanSpanish = new Set(
  "MX GT SV HN NI CR PA CU DO PR CO VE EC PE BO CL AR UY PY US 419 003 005 013 019 029".split(" "),
);

const languageIds: Record<string, number> = {
  ar: Language.Arabic,
  cs: Language.Czech,
  da: Language.Danish,
  nl: Language.Dutch,
  fi: Language.Finnish,
  fr: Language.French,
  he: Language.Hebrew,
  iw: Language.Hebrew,
  hu: Language.Hungarian,
  it: Language.Italian,
  ja: Language.Japanese,
  ko: Language.Korean,
  nb: Language.Norwegian,
  nn: Language.Norwegian,
  no: Language.Norwegian,
  pl: Language.Polish,
  ru: Language.Russian,
  sv: Language.Swedish,
  tr: Language.Turkish,
  th: Language.Thai,
  vi: Language.Vietnamese,
  de: Language.German,
  uk: Language.Ukrainian,
};

/**
 * What IGDB data a locale (`"fr-FR"`, `"ja"`, `"zh-Hant"`, `"pt_BR"`) picks: release region, game
 * localizations, age rating organizations and IGDB languages. A locale without a country gets its
 * likely one (`"fr"` is France, `"en"` the US, `"zh"` China). The other helpers of `igdb-kit/game`
 * call it for their `locale` option.
 *
 * ```ts
 * resolveLocale("fr-CA");
 * // { locale: "fr-CA", language: "fr", script: "Latn", country: "CA", releaseRegion: 2,
 * //   localizationRegions: [], ageRatingOrganizations: [1, 2], languages: [12] }
 * ```
 */
export function resolveLocale(locale: string): ResolvedLocale {
  const { canonical, language, script, country } = parseLocale(locale);
  let releaseRegion: number | null = null;
  if (country)
    releaseRegion = europeanCountries.has(country)
      ? ReleaseDateRegion.Europe
      : (releaseRegions[country] ?? null);
  const localizationRegions: number[] = [];
  if (language === "ja") localizationRegions.push(Region.Japan);
  if (language === "ko") localizationRegions.push(Region.Korea);
  if (country && (europeanCountries.has(country) || country === "150"))
    localizationRegions.push(Region.Europe);
  return {
    locale: canonical,
    language,
    script,
    country,
    releaseRegion,
    localizationRegions,
    ageRatingOrganizations: country ? ageRatingOrganizations(country) : [],
    languages: igdbLanguages(language, script, country),
  };
}

function ageRatingOrganizations(country: string): number[] {
  const own = ageRatingsByCountry[country];
  if (own) return [...own];
  if (europeanCountries.has(country) || country === "150") return [PEGI, ESRB];
  return americas.has(country) ? [ESRB, PEGI] : [PEGI, ESRB];
}

function igdbLanguages(language: string, script: string | null, country: string | null): number[] {
  const { English, EnglishUK, SpanishSpain, SpanishMexico, ChineseSimplified, ChineseTraditional } = Language;
  switch (language) {
    case "en":
      return country === null || americanEnglish.has(country) ? [English, EnglishUK] : [EnglishUK, English];
    case "es":
      return country !== null && latinAmericanSpanish.has(country)
        ? [SpanishMexico, SpanishSpain]
        : [SpanishSpain, SpanishMexico];
    case "pt":
      return country === "PT" || (country !== null && country !== "BR" && /^[A-Z]{2}$/.test(country))
        ? [Language.PortuguesePortugal, Language.PortugueseBrazil]
        : [Language.PortugueseBrazil, Language.PortuguesePortugal];
    case "zh":
      return script === "Hant"
        ? [ChineseTraditional, ChineseSimplified]
        : [ChineseSimplified, ChineseTraditional];
    default: {
      const id = languageIds[language];
      return id === undefined ? [] : [id];
    }
  }
}

/**
 * The language, script and country of a locale, the script and country completed with their likely
 * values when the runtime knows them (`Intl.Locale.prototype.maximize`).
 */
export function parseLocale(locale: string): {
  canonical: string;
  language: string;
  script: string | null;
  country: string | null;
} {
  const tag = locale.trim().replace(/_/g, "-");
  try {
    const given = new Intl.Locale(tag);
    const likely = given.maximize();
    return {
      canonical: given.toString(),
      language: given.language,
      script: likely.script ?? null,
      country: likely.region ?? null,
    };
  } catch {
    // Not a valid BCP 47 tag: read what can be read.
    const parts = tag.split("-");
    const language = (parts[0] ?? "").toLowerCase();
    const script = parts.find((p, i) => i > 0 && /^[a-z]{4}$/i.test(p));
    const country = parts.find((p, i) => i > 0 && /^(?:[a-z]{2}|\d{3})$/i.test(p))?.toUpperCase();
    return {
      canonical: tag,
      language,
      script: script ? script[0]?.toUpperCase() + script.slice(1).toLowerCase() : null,
      country: country ?? null,
    };
  }
}
