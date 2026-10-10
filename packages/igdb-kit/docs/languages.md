# Languages

IGDB's data is mostly in English, with the other languages spread over localizations, alternative names and language supports. igdb-kit gathers them so a page can follow the user's locale (`"fr-FR"`, `"ja"`, `"pt-BR"`).

| To | Use | In |
|---|---|---|
| Show a game's title in the user's language | `localizedName(game, locale)` | [`igdb-kit/game`](display.md#names-and-languages) |
| Show the box art of the user's region | `localizedCover(game, locale)` | [`igdb-kit/game`](display.md#names-and-languages) |
| Show genres, themes, statuses and other labels | `createLabels([fr, ja]).label(table, id, locale)` | [`igdb-kit/i18n`](#translated-labels-igdb-kiti18n) |
| Show the release date of the user's region | `releaseDate(game, { locale })`, then `formatReleaseDate(release, { locale })` | [`igdb-kit/game`](display.md#release-dates) |
| Show the age rating of the user's country | `ageRating(game, { locale })` | [`igdb-kit/game`](display.md#age-ratings) |
| Link to stores in the user's language | `storeLinks(game, { locale })` | [`igdb-kit/game`](display.md#companies-stores-and-links) |
| Say whether a game has audio, subtitles or interface in the user's language | `supportsLanguage(game, locale)`, `languages(game, { locale })` | [`igdb-kit/game`](display.md#names-and-languages) |
| Keep only games with a French voice-over | `where((g) => g.supportsLanguage("fr-FR", "audio"))` | [Queries](queries.md#named-filters-on-games) |
| Name regions, countries and languages | `releaseRegionName()`, `countryName()`, `languageName()` | [`igdb-kit/game`](display.md#names-and-languages) |
| Show an event's time in the user's zone | `eventTime(event, { locale, timeZone })` | [`igdb-kit/game`](display.md#names-and-languages) |
| Find games by a title in another language | `searchAll("ウィッチャー")`, `games.match({ name: "Pokémon Épée" })` | [Finding games](finding-games.md#titles-in-other-languages) |
| Read IGDB's alternative names | `alternativeTitles(game)`, `parseAlternativeName(comment)` | [`igdb-kit/game`](display.md#names-and-languages) |

## What a locale picks

`resolveLocale(locale)` says what a locale picks in IGDB, and the `locale` options of `igdb-kit/game` and the `supportsLanguage()` filter read it: its release region, its game localization regions, its age rating organizations and its IGDB languages, best first. `"en-GB"` prefers English (UK) then English, `"de-DE"` takes USK then PEGI and ESRB, and `"ja-JP"` CERO then ESRB and PEGI. A locale without a country takes its likely one: `"fr"` is France, `"en"` the US, `"zh"` China.

```ts
import { resolveLocale } from "igdb-kit/game";

resolveLocale("fr");
// { locale: "fr", language: "fr", script: "Latn", country: "FR", releaseRegion: 1 (Europe),
//   localizationRegions: [4] (Europe), ageRatingOrganizations: [2, 1] (PEGI, ESRB), languages: [12] (French) }
```

## Translated labels: igdb-kit/i18n

IGDB names its genres, themes, game modes, statuses and other reference rows in English only. `igdb-kit/i18n` has them in French, German, Spanish, Brazilian Portuguese, Polish, Russian, Japanese and Simplified Chinese, and in English with IGDB's slips fixed (`Operating_system`, `Postitive Reviews`, lowercase regions). Each language is an entry point of its own, so an app ships only the languages it imports.

```ts
import { createLabels } from "igdb-kit/i18n";
import { fr } from "igdb-kit/i18n/fr";
import { ja } from "igdb-kit/i18n/ja";
import { Genre, ReleaseDateStatus } from "igdb-kit";

const { label, description, entries } = createLabels([fr, ja]);
label("genres", Genre.RolePlayingRPG, "fr-FR");      // "Jeu de rôle (RPG)"
game.genres?.map((genre) => label("genres", genre, locale)); // ids or rows
rating.row.rating_content_descriptions?.map((d) => label("age_rating_content_descriptions_v2", d, "ja"));
description("release_date_statuses", ReleaseDateStatus.EarlyAccess, "fr"); // for a tooltip
entries("themes", "fr");                              // [{ id: 1, label: "Action" }, ...]: a filter's options
```

- **Tables:** 27 tables by endpoint name (`genres`, `themes`, `game_modes`, `player_perspectives`, `game_types`, `game_statuses`, `release_date_statuses`, `release_date_regions`, `website_types`, `popularity_types`, `company_sizes`, `image_types`, `artwork_types`…) and the 97 content descriptors of the ESRB, PEGI, CERO, GRAC and ClassInd, with descriptions for release statuses and collection types. Platforms, companies and games keep their names: for a game's title in the user's language, see [`localizedName()`](display.md#names-and-languages).
- **Locales:** a locale reads the dictionaries of its language and script, the one of its country first (`fr-CA` reads `fr`, `pt-PT` reads `pt-BR`, `zh-TW` does not read `zh-CN`), then English.
- **New rows:** a row passed as an object (`{ id, name }`) keeps its own English label when its id was added to IGDB after this version; an id alone gives `null`.
- **Your own texts:** a `LabelDictionary` is a plain object. Pass one for another language, or before a built-in one to change some labels: an id it leaves out comes from the next dictionary.
