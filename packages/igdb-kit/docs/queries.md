# Queries

Every endpoint is a query builder on the client: `igdb.games`, `igdb.platforms`, `igdb.release_dates`… Queries are immutable and awaitable, and nothing is sent before they are awaited. They are compiled to Apicalypse, which you can inspect with `query.toApicalypse()`.

- [Types](#types)
- [Selecting fields](#selecting-fields)
- [Filtering](#filtering): operators, relations by name, named filters on games, reference ids, dates
- [Reading results](#reading-results): one row, ids, counts, paging

## Types

Entities are generated from IGDB's `igdbapi.proto`, merged with the API docs for descriptions and `@deprecated` notices. All 84 endpoints are included, `executables`, `logos` and the tier-restricted `content_safety_*` ones among them. Fields IGDB replaced, such as `category`, are left out because they are empty or no longer updated (see [Replaced fields](#replaced-fields-and-slow-filters)).

The type of every response is inferred from the fields you select: nested objects for expanded relations, ids for the others, and every field except `id` is optional because IGDB omits empty fields. Field paths are checked by TypeScript as you type, and again at runtime before the request leaves: IGDB rejects a whole multiquery for one bad field and silently ignores an unknown `sort` field.

## Selecting fields

| Path | Result |
|---|---|
| `"name"` | `name?: string` |
| `"cover"` | `cover?: number` (the id) |
| `"cover.image_id"` | `cover?: { id: number; image_id?: string }` |
| `"platforms.*"` | every field of each platform |
| `"*"` | every field, relations as ids |
| `"involved_companies.company.name"` | nested as deep as you need |

`exclude()` leaves selected fields out, at any depth, and removes them from the result type. It is the way to take "everything but" with `*`, for example to keep `sync()` copies small:

```ts
const games = await igdb.games.select("*", "cover.*").exclude("summary", "storyline", "cover.url");
// no summary or storyline; cover without url
```

Only fields the selection covers can be excluded: IGDB rejects the others once a relation is expanded, ignores unknown ones, and always returns `id`. To drop an expanded relation, remove it from `select`.

## Filtering

```ts
igdb.games.where((g) => g.name.startsWith("Super"));                  // name ~ "Super"*
igdb.games.where((g) => g.name.contains("smash", { caseSensitive: true }));
igdb.games.where((g) => g.platforms.any(48, 49, 6));                   // platforms = (48,49,6)
igdb.games.where((g) => g.platforms.all(6, 48));                       // platforms = [6,48]
igdb.games.where((g) => g.themes.none(42));                            // themes != (42)
igdb.games.where((g) => g.cover.isNull());
igdb.games.where((g) => g.release_dates.platform.eq(6));               // filter on a relation's field
igdb.games.where((g) => g.platforms.named("PS5", "Nintendo Switch"));   // a relation by name: platforms = (130,167)
igdb.games.where((g) => g.name.eq("the witcher 3: wild hunt", { caseSensitive: false })); // name ~ "…"
igdb.games.where((g) => or(and(g.rating.gte(80), g.hypes.gt(10)), g.total_rating_count.gt(100)));
igdb.games.where("rating > 80");                                       // raw Apicalypse
```

Each field only offers the operators that fit its type, and enum fields only accept their values.

### Relations by name

`named()` works on any relation to a table with names: platforms (also by abbreviation or alternative name: "PS5", "Switch", "PSX"), genres ("RPG" matches "Role-playing (RPG)"), themes, game modes, franchises, collections, keywords, companies... A name matches in full, ignoring case.

igdb-kit looks the names up before sending the query and filters on their ids: a reference table is read whole once and cached for a day, any other table costs one cached request per name. A name that matches nothing throws a `NotFoundError` whose `suggestions` lists close names.

### Named filters on games

On `games`, named filters cover the common relation lookups:

```ts
import { and, Platform, ReleaseDateRegion } from "igdb-kit";

igdb.games.where((g) => g.developedBy(908));                           // CD Projekt RED as developer
igdb.games.where((g) => g.developedBy("CD Projekt RED"));               // the same, by name
igdb.games.where((g) => and(g.publishedBy(50), g.rating.gte(80)));     // WB Games as (regional) publisher
igdb.games.where((g) =>
  g.releasedIn({ platforms: Platform.NintendoSwitch, regions: ReleaseDateRegion.Europe, from: "2021-01-01" }),
);
igdb.games.where((g) => g.supportsLanguage("fr-FR", "audio"));         // a French voice-over
igdb.games.where((g) => g.mainGames());                                // full games, as a catalog lists them
igdb.games.where((g) => g.playableTogether({ platforms: Platform.NintendoSwitch, players: 4, mode: "local" }));
```

- **`mainGames()`** keeps the `MAIN_GAME_TYPES` (no DLCs, mods, bundles, episodes, packs or updates) without editions, the Erotic theme, and offline, cancelled or rumored games: 312,206 games, 82% of IGDB. Its options are `includeUndated` (default true; false leaves out the 24% without a release date), `includeAdult`, `includeEditions` and `requireCover`.
- **`playableTogether()`** reads `multiplayer_modes`, every condition on one row: `players` (default 2), `mode` (`"local"` or `"online"`, default either), `coop` (co-op only) and `platforms` (a row without a platform applies to all). Only 5.7% of main games have multiplayer data.
- **`developedBy()` and `publishedBy()`** take ids or names, not both in one call. A name matches a whole company name, ignoring case: "CD Projekt RED" matches, "CD Projekt" or "cd projekt red studio" do not, and "Ubisoft" is not "Ubisoft Montreal". igdb-kit looks the names up in `companies` before sending the query (one request, cached for a day) and filters on their ids: IGDB answers a filter on `involved_companies.company.name` in 10 to 25 seconds, and the same filter on ids in well under one. A name that matches no company throws a `NotFoundError` whose `suggestions` lists the companies that contain it, such as "Ubisoft Entertainment" and "Ubisoft Montreal" for "Ubisoft". `toApicalypse()` shows the name form, which IGDB also accepts.
- **`supportsLanguage()`** takes `Language` ids or a locale, whose IGDB languages it uses (`"en-GB"`: English (UK) or English), and optionally one kind of support, `"audio"`, `"subtitles"` or `"interface"`, matched on the same `language_supports` row: two of them in one `where` match nothing.
- **`releasedIn()`** takes the options of the [release calendar](releases.md): `platforms` and `regions` (one id or several), `includeWorldwide`, `statuses`, `from` and `to`. Worldwide releases count for every region (pass `includeWorldwide: false` to change that), release dates marked Cancelled or Offline are left out unless `statuses` lists them, and release dates without a status, more than half of them, count (`null` in `statuses`).

These filters rely on how IGDB filters arrays of relations: every condition on `involved_companies` (or `release_dates`) in a `where` must hold for the same entry.

- `developedBy(50)` does not match The Witcher 3, which WB Games only published.
- `releasedIn` needs one release date with that platform, region and date together.
- `and(g.developedBy(908), g.publishedBy(50))` asks for one company entry that is both, and matches nothing; run two queries instead.
- `g.platforms.any()` lists every announced platform, cancelled ones included, where `releasedIn({ platforms })` looks at actual release dates.
- For franchises and series, `g.franchises.any(id)` and `g.collections.any(id)` are enough: the main `franchise` is always in `franchises`, and `collections` matches `collection_memberships` (spin-offs included).

### Reference ids

Reference tables come with named ids, so you don't hard-code `game_type = 0` or `platforms = 48`:

```ts
import { GameType, Platform, Theme } from "igdb-kit";

igdb.games.where((g) =>
  and(
    g.game_type.in(GameType.MainGame, GameType.Remake, GameType.Remaster),
    g.version_parent.isNull(),                                          // no editions
    g.platforms.any(Platform.PlayStation5, Platform.PCMicrosoftWindows),
    g.themes.none(Theme.Erotic),
  ),
);
```

`GameType`, `GameStatus`, `GameReleaseFormat`, `Genre`, `Theme`, `GameMode`, `PlayerPerspective`, `Platform`, `PlatformType`, `PlatformFamily`, `ExternalGameSource`, `PopularityType`, `ReleaseDateRegion`, `ReleaseDateStatus`, `DateFormat`, `WebsiteType`, `AgeRatingOrganization`, `AgeRatingCategory`, `Language`, `LanguageSupportType`, `Region` (of `game_localizations`), `CompanyStatus`, `CompanySize`, `CompanyType`, `CollectionType`, `CollectionMembershipType`, `CollectionRelationType`, `NetworkType`, `ImageType`, `ArtworkType`, `CharacterGender` and `CharacterSpecie` are generated from the API. Age ratings repeat across organizations, so their keys start with it: `AgeRatingCategory.PEGI_18`, `AgeRatingCategory.ESRB_M`.

### Dates

IGDB timestamps (`first_release_date`, `release_dates.date`, `updated_at`…) are Unix seconds, not milliseconds. Everywhere igdb-kit takes a date (`where` on a timestamp field, `releasedIn()`, `releases()`, `sync({ since })`), it accepts a `Date`, a `"YYYY-MM-DD"` or ISO string, or Unix seconds; a number in milliseconds, such as `Date.now()`, throws instead of matching nothing. `between(from, to)` is on or after `from` and before `to`, and `toDate()` / `toUnix()` convert either way:

```ts
import { toDate } from "igdb-kit";

const upcoming = await igdb.release_dates
  .select("date", "human", "game.name")
  .where((r) => r.date.gte(new Date()))                               // date >= 1791504000
  .sort("date", "asc");
toDate(upcoming[0].date!);                                            // a Date

igdb.games.where((g) => g.first_release_date.between("2026-01-01", "2027-01-01"));
```

### Replaced fields and slow filters

IGDB replaced several fields with reference tables: `games.category` became `game_type`, `release_dates.region` became `release_region`, `external_games.category` became `external_game_source`, and so on. IGDB still accepts the old names but leaves them empty or no longer updates them, so `where category = 0` silently matches nothing. igdb-kit leaves them out of the types and throws a `QueryError` that names the replacement. One exception stays, marked deprecated: IGDB still fills `artworks.artwork_type` on 99.5% of artworks, where its replacement `image_type` is on about half (see [`artworkType()`](display.md#image-urls)).

Avoid filters three levels deep, such as `involved_companies.company.name`: IGDB takes 10 to 25 seconds and can time out after about 27. Look the id up first, then filter on `involved_companies.company`; `developedBy()` and `publishedBy()` do it for you.

## Reading results

```ts
await igdb.games.select("name").first();                 // R | null
await igdb.games.select("name").findById(1942);          // R | null
await igdb.games.select("name").findByIdOrThrow(1942);   // R, or throws NotFoundError (also firstOrThrow())
await igdb.games.select("name").findByIds(ids);          // R[], in the order given, 500 per request at most
await igdb.games.where((g) => g.rating.gte(90)).count(); // number
await igdb.games.select("name").limit(20).withCount();   // { data: R[]; total: number }, one request
for await (const game of igdb.games.select("name").iterate()) {
  // every match, paged with an id cursor (stable and fast at any depth, unlike offset)
}
await igdb.games.select("name").search("zelda").limit(5); // searchable endpoints only, no sort
await igdb.games.select("name").catch(() => []);         // a query is a promise: then, catch, finally
```

`findByIds()`, `iterate()` and `sync()` size their pages by weight: 500 rows of a light selection, fewer of a heavy one, so that a page stays near `maxBatchBytes` (4 MB). A game with its media, companies, release dates and websites expanded weighs about 20 KB, so such pages hold about 200 games. The weight of a row starts from a cautious guess and is learned from each response. A page IGDB refuses for its size (above 10 MB, or not built within 29 seconds) is asked again in halves.

`iterate({ pageSize })` caps the page at 1 to 500 rows. `iterate()` and `sync()` read in id order and throw on any other `sort()`: sort the rows once read. A query with your own `limit` is never split: lower its `limit` if IGDB answers that the response is too large.
