---
"igdb-kit": minor
---

Localized display helpers in `igdb-kit/game`:

- `formatReleaseDate(release, { locale })` writes a release date in the user's language from its precision: "19 nov. 2026", "nov. 2026", "T4 2026", "2026", "À déterminer". It takes the result of `releaseDate()` or a calendar release of `releases()`. Quarters and TBD come from a table of 13 languages, with English otherwise unless `labels` gives them.
- `regionalReleases(game, { platform })` returns one release per region, earliest first, for games whose date changes with the region.
- `releaseRegionName(id, locale)`, `countryName(code, locale)` and `languageName(language, locale)` name release regions, countries (IGDB's numeric codes, such as `companies.country`) and IGDB languages (`Language.ChineseSimplified` is "Simplified Chinese", "Spanish (Mexico)" is Latin American Spanish) with `Intl`.
- `eventTime(event, { locale, timeZone })` turns IGDB's time zone abbreviations (`PST`, `JST`, `CET`), which Bun rejects, into IANA zones, and writes the event's start in the user's zone.
- `languages(game, { locale })` lists the user's languages first, and `supportsLanguage(game, locale)` says whether a game has audio, subtitles and interface in the user's language (`null` when IGDB does not know).
- `ageRating(game, { locale })` takes the country's organization, then ESRB and PEGI.
- `storeLinks(game, { locale })` and `localizeStoreUrl(url, locale)` give PlayStation, Xbox, Epic and GOG pages in the user's language, and `storeLinks` leaves out Amazon products sold in other countries. Amazon products sold in India now get a built URL.
