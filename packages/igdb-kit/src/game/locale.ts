/**
 * Countries whose games IGDB files under Europe: the European release region, and the European
 * localization (PAL titles).
 */
export const europeanCountries = new Set(
  "AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GI GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK".split(
    " ",
  ),
);

/** The language, country and script of a locale (`ja-JP`, `zh-Hant-TW`, `pt_BR`). */
export function parseLocale(locale: string): {
  language: string;
  country: string | undefined;
  script: string | undefined;
} {
  const parts = locale.replace(/_/g, "-").split("-");
  const language = (parts[0] ?? "").toLowerCase();
  const script = parts.find((p, i) => i > 0 && p.length === 4)?.toLowerCase();
  const country = parts.find((p, i) => i > 0 && /^[a-z]{2}$/i.test(p))?.toUpperCase();
  return { language, country, script };
}
