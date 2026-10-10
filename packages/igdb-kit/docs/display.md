# Displaying a game

IGDB returns raw rows: several release dates per platform and region, companies with role flags, store ids, rating category ids. `igdb-kit/game` turns a query result into what a page shows, with no request.

- [Using the helpers](#using-the-helpers)
- [Release dates](#release-dates) · [Companies, stores and links](#companies-stores-and-links) · [Age ratings](#age-ratings) · [Names and languages](#names-and-languages) · [Related games](#related-games) · [Multiplayer and playtime](#multiplayer-and-playtime) · [Pictures and platform versions](#pictures-and-platform-versions)
- [Missing data](#missing-data)
- [Image URLs](#image-urls)

For IGDB's genres, themes and other labels in the user's language, see [Languages](languages.md).

## Using the helpers

Each helper requires the fields it reads at compile time (a missing one is an error naming it, such as `select("release_dates.status") is missing`) and accepts any richer selection; `release_dates.*` style wildcards work too.

```ts
import { ageRating, companies, localizedName, releaseDate, storeLinks } from "igdb-kit/game";
import { AgeRatingOrganization, Platform, ReleaseDateRegion } from "igdb-kit";

const game = await igdb.games
  .select("name", "release_dates.*", "involved_companies.company.name", "involved_companies.developer",
    "involved_companies.publisher", "involved_companies.porting", "involved_companies.supporting",
    "websites.url", "websites.trusted", "age_ratings.organization", "age_ratings.rating_category")
  .findByIdOrThrow(1942);

releaseDate(game, { locale: "fr-FR", platform: Platform.NintendoSwitch });
// { precision: "day", start, end, year: 2021, month: 1, day: 28, status: 6, region: 8, match: "worldwide", ... }
companies(game).developers;                          // [{ id: 908, name: "CD Projekt RED" }]
storeLinks(game);                                    // [{ store: "epic", url, trusted: true, ... }, { store: "steam", ... }]
ageRating(game, [AgeRatingOrganization.PEGI, AgeRatingOrganization.ESRB]); // { label: "18", minimumAge: 18, ... }
```

## Release dates

- **`releaseDate(game, { region?, locale?, platform?, statuses? })`** returns the date to show, with the fields of a [calendar release](releases.md#precision) (`precision`, `start`, `end`, `year`, `quarter`, `month`, `day`, `status`…) and `match` (`exact`, `worldwide`, `other_region`). Full release first, as IGDB's `first_release_date` does (not early or advanced access), then the region's own row over worldwide. `locale` picks the region from its country (`fr-FR`: Europe, `en-US`: North America, `ja-JP`: Japan), or its likely country when it has none (`fr`: France). Half of the dates have no status: `status` is `null`, and they are not excluded. Quarters and years are stored as the period's last day: `start`, `end` and `precision` place them.
- **`releasesByPlatform(game, { region?, locale? })`** and **`regionalReleases(game, { platform? })`** return one release per platform, or per region, earliest first. For 18% of the 1,000 most popular games, a platform's date changes with the region.
- **`formatReleaseDate(release, { locale, dateStyle? })`** writes `"19 nov. 2026"`, `"T4 2026"`, `"À déterminer"`. IGDB's `human` is always in English. Days and months come from `Intl`, quarters and TBD from a table of 13 languages (English otherwise, or your `labels`).

## Companies, stores and links

- **`companies(game)`** returns `{ developers, publishers, porting, supporting }` with your selected company fields. It handles several regional publishers and a company listed twice.
- **`storeLinks(game, { stores?, locale? })`** and **`localizeStoreUrl(url, locale)`** give one link per store product from `websites` and `external_games`. The store comes from the address: archived copies and mistyped links are dropped. Missing URLs are built for Steam, Google Play and single-country Amazon products. With `locale`, PlayStation, Xbox, Epic and GOG pages are in the user's language (99.5% of IGDB's PlayStation links are `en-us`) and Amazon products of other countries are left out.
- **`externalIds(game, source?)`** and **`externalId(game, source)`** return `[{ source, uid, url }]` and `"292030"`: a game's ids in stores and services, several per source (1,830 games have two or three Steam appids), duplicates dropped. IGDB has no PlayStation trophy ids, only store concept ids, and no Nintendo, Ubisoft, EA or Battle.net source.
- **`websiteLinks(game, { kinds? })`** returns `[{ kind, type, url, trusted }]`: official site, wikis, social networks and stores, by `kind`. IGDB never marks official sites as trusted, so nothing is dropped for it; social links with no page are.
- **`videoLinks(game)`** returns `[{ kind, name, video_id, url, embedUrl, thumbnailUrl }]`: YouTube links, with `trailer`, `gameplay`, `teaser`, `intro` or `other` read from the name.

## Age ratings

- **`ageRating(game, organization | { locale })`** and **`ageRatings(game)`** return `label` (`18`, `M`, `MA 15+`), `minimumAge`, `descriptors` and `synopsis`, or null. Labels and ages cover all 40 IGDB categories; with two ratings from one organization, the strictest wins. `{ locale }` takes the country's organization, then ESRB and PEGI.

## Names and languages

- **`localizedName(game, locale)`** and **`localization(game, locale)`** return `{ name, source, language, variant }`: the regional localization (`ja-JP`, `ko-KR`), then an alternative name in the locale's language ("Japanese title", "Chinese title - traditional", "Brazilian title", "UK title" for `en-GB`), then the European title for a European locale, then `name`. Romanizations, abbreviations and unofficial titles are skipped, and so is a name in the wrong script: a "Japanese title" in Latin letters is often a romanization.
- **`localizedCover(game, locale)`** returns `{ image_id, source, region }`: the Japanese, Korean or European box art of the game's localizations, then `cover`. A query of `covers` by game misses these.
- **`alternativeTitles(game)`** and **`parseAlternativeName(comment)`** return `{ name, kind, language, variant }` from IGDB's 739 free-text comments ("Japanese title - romanization", "Korean Acroynm", "Steam title"): `kind` is `language`, `regional`, `platform`, `alternative`, `stylized`, `abbreviation`, `working`… and `language` a BCP 47 tag (`zh-Hant`, `pt-BR`). Executable file names are left out.
- **`resolveLocale(locale)`** returns `{ country, releaseRegion, localizationRegions, ageRatingOrganizations, languages }`: what a locale picks in IGDB, used by the `locale` options. `"fr"` is France and Europe, `"en-GB"` prefers `Language.EnglishUK`, `"de-DE"` USK then PEGI and ESRB.
- **`languages(game, { locale? })`** and **`supportsLanguage(game, locale)`** return `audio`, `subtitles` and `interface` per language, or for the user's: `null` when the game has no data of that kind, `false` when other languages have it. `locale` puts the user's languages first; Spanish (Spain) counts for `es-MX`.
- **`releaseRegionName(id, locale)`**, **`countryName(code, locale)`** and **`languageName(language, locale)`** return `"Amérique du Nord"`, `"France"`, `"chinois simplifié"`, with names from `Intl`. `countryName` reads IGDB's numeric codes (`companies.country`: 250); `languageName` takes a `Language` id or IGDB's `locale` (`"es-MX"` is Latin American Spanish).
- **`eventTime(event, { locale, timeZone? })`** returns `{ start, end, timeZone, text }`. IGDB's zones are abbreviations (`PST`, `JST`, `CET`) that Bun rejects: they become IANA zones.

## Related games

- **`parentGame(game)`** returns `{ relation, game, title }` for editions, DLCs, expansions, remakes, ports..., from `version_parent` and `parent_game`, named from `game_type`.
- **`relatedGames(game)`** and **`relatedGameFields(...fields)`** return `{ parent, dlcs, expansions, standalone_expansions, remakes, remasters, expanded_games, ports, forks, bundles }`. Lists are empty rather than undefined; `relatedGameFields("name")` selects them all with their names. A game's own fields cannot show its editions, mods, episodes, seasons, packs and updates: they point to it and no array lists them (see [`family()`](linked-data.md#related-games-family-series-catalog)).
- **`groupByParent(games, { relations? })`** returns `{ groups: [{ game, members }], missingParents }`: the editions and ports of a list (a company's catalog, search results, a library) under their original. A parent missing from the list is an id to load.
- **`franchisesOf(game)`** returns `{ main, others }`. IGDB sets `franchise` on 1,348 games and `franchises` on 29,259.

## Multiplayer and playtime

- **`multiplayer(game, platform?)`** returns player counts and co-op flags per platform. IGDB's 0 means unknown, so counts are `null` then. With a platform, it returns that platform's row, else the row that applies to every platform, else null.
- **`timeToBeat(row, { prefer? })`** and **`formatPlaytime(seconds)`** return `{ seconds, kind, count }` and `"71 hr"`, from rows of `game_time_to_beats` (97% of games have none), localized with `Intl`.

## Pictures and platform versions

- **`bestImage(game, { prefer? })`** returns `{ image_id, source, type, width, height, ratio }`: the cover, else a cover artwork, key art or a screenshot (13% of complete games have no cover). `prefer: "background"` gives a wide image for a banner. Never a logo or an icon.
- **`platformVersions(platform, { locale? })`** returns `[{ version, release, releases }]`: the versions of a console (Slim, Pro, OLED) earliest first, with the date for the user's region.

## Missing data

Data is often missing, and helpers keep "unknown" apart from "no": 79% of games have no age rating, 39% of main games no language data, 94% no multiplayer data. A missing value is `null`, never `undefined`, so results survive `JSON.stringify` (and Next.js props), and references are ids: statuses are `ReleaseDateStatus` ids, store link formats `GameReleaseFormat` ids.

## Image URLs

```ts
import { imageSrcSet, imageUrl } from "igdb-kit";

imageUrl(game.cover?.image_id, "cover_big", { retina: true });
// https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1wyy.jpg (undefined if there is no cover)
imageUrl(game.cover?.url, "cover_big"); // the url field IGDB returns (always t_thumb) works too
imageSrcSet(game.cover?.image_id, "cover_big"); // "…/t_cover_big/co1wyy.jpg 1x, …/t_cover_big_2x/co1wyy.jpg 2x"
```

`artworkType()` gives the `ImageType` of an artwork. IGDB fills `image_type` on about half of the artworks and the deprecated `artwork_type` on nearly all, numbered differently (8 is "Infographic" in `artwork_types` and "Main cover" in `image_types`), so it reads `image_type` and falls back to `artwork_type` converted:

```ts
import { artworkType, ImageType } from "igdb-kit";

const artworks = await igdb.artworks
  .select("image_id", "image_type", "artwork_type")
  .where((a) => a.game.eq(1942));
const conceptArt = artworks.filter((a) => artworkType(a) === ImageType.ConceptArt);
```
