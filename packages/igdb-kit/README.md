# igdb-kit

[![npm](https://img.shields.io/npm/v/igdb-kit)](https://www.npmjs.com/package/igdb-kit)
[![CI](https://github.com/7IBO/igdb-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/7IBO/igdb-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/igdb-kit)](https://github.com/7IBO/igdb-kit/blob/main/LICENSE)

A fully typed [IGDB](https://api-docs.igdb.com/) API client for Node.js and Bun, and for the browser through your own proxy.

- **Exact result types.** The type of every response is inferred from the fields you select: nested objects for expanded relations, ids for the others, and every field except `id` is optional because IGDB omits empty fields.
- **Generated from the official schema.** Entities come from IGDB's `igdbapi.proto`, merged with the API docs for descriptions and `@deprecated` notices. Fields IGDB replaced, such as `category`, are left out because they are empty or no longer updated. All 84 endpoints are included, `executables`, `logos` and the tier-restricted `content_safety_*` ones among them.
- **Field paths checked twice.** TypeScript checks them as you type, and they are checked again at runtime before the request leaves. IGDB rejects a whole multiquery for one bad field and silently ignores an unknown `sort` field.
- **Rate limit done right.** One limiter per client id, shared by every client in the process (4 requests per second, 8 in flight). After a 429 the whole queue pauses and slows down, because IGDB sends no `Retry-After`.
- **Automatic multiquery.** Queries started at the same time are grouped into `/multiquery` requests of up to 10 blocks, so 30 `findById` calls cost 3 HTTP requests. Batches are sized by estimated response size to stay under IGDB's 10 MB cap, and their bodies stay under its 32,000-byte limit. An invalid query or an oversized response is isolated by splitting the batch, so only the faulty query fails. Identical queries in flight are sent once.
- **Auth that recovers.** Tokens are fetched once for all concurrent requests, renewed before they expire, and renewed then replayed once after a 401. A token store can be shared across processes, since Twitch keeps only 25 active tokens per app.

> Versions 0.x may change the API between minor releases. See the [changelog](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/CHANGELOG.md).

## Install

```sh
npm install igdb-kit
# or
bun add igdb-kit
```

You need a Twitch application: create one in the [Twitch developer console](https://dev.twitch.tv/console/apps) and use its client id and client secret. The client secret must stay on the server.

## Usage

```ts
import { and, createIGDB, or } from "igdb-kit";

const igdb = createIGDB({
  clientId: process.env.TWITCH_CLIENT_ID!,
  clientSecret: process.env.TWITCH_CLIENT_SECRET!,
});

const games = await igdb.games
  .select("name", "rating", "cover.image_id", "platforms.name", "genres")
  .where((g) => g.rating.gte(80).and(g.platforms.any(6, 48)))
  .sort("rating", "desc")
  .limit(10);
// {
//   id: number;
//   name?: string;
//   rating?: number;
//   cover?: { id: number; image_id?: string };
//   platforms?: { id: number; name?: string }[];
//   genres?: number[];          // not expanded: ids
// }[]
```

Queries are immutable and awaitable. They are compiled to Apicalypse, which you can inspect with `query.toApicalypse()`.

### Selecting fields

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

### Filtering

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

`named()` works on any relation to a table with names: platforms (also by abbreviation or alternative name: "PS5", "Switch", "PSX"), genres ("RPG" matches "Role-playing (RPG)"), themes, game modes, franchises, collections, keywords, companies... A name matches in full, ignoring case. igdb-kit looks the names up before sending the query and filters on their ids: a reference table is read whole once and cached for a day, any other table costs one cached request per name. A name that matches nothing throws a `NotFoundError` whose `suggestions` lists close names.

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
igdb.games.where((g) => g.playableTogether({ platform: Platform.NintendoSwitch, players: 4, mode: "local" }));
```

`mainGames()` keeps the `MAIN_GAME_TYPES` (no DLCs, mods, bundles, episodes, packs or updates) without editions, the Erotic theme, and offline, cancelled or rumored games: 312,206 games, 82% of IGDB. Its options are `includeUndated` (default true; false leaves out the 24% without a release date), `includeAdult`, `includeEditions` and `requireCover`. `playableTogether()` reads `multiplayer_modes`, every condition on one row: `players` (default 2), `mode` (`"local"` or `"online"`, default either), `coop` (co-op only) and `platform` (a row without a platform applies to all). Only 5.7% of main games have multiplayer data.

A name matches a whole company name, ignoring case: "CD Projekt RED" matches, "CD Projekt" or "cd projekt red studio" do not, and "Ubisoft" is not "Ubisoft Montreal". Pass ids or names, not both in one call. igdb-kit looks the names up in `companies` before sending the query (one request, cached for a day) and filters on their ids: IGDB answers a filter on `involved_companies.company.name` in 10 to 25 seconds, and the same filter on ids in well under one. A name that matches no company throws a `NotFoundError` whose `suggestions` lists the companies that contain it, such as "Ubisoft Entertainment" and "Ubisoft Montreal" for "Ubisoft". `toApicalypse()` shows the name form, which IGDB also accepts. These filters rely on how IGDB filters arrays of relations: every condition on `involved_companies` (or `release_dates`) in a `where` must hold for the same entry. `developedBy(50)` does not match The Witcher 3, which WB Games only published, and `releasedIn` needs one release date with that platform, region and date together. `supportsLanguage` takes `Language` ids or a locale, whose IGDB languages it uses (`"en-GB"`: English (UK) or English), and optionally one kind of support, `"audio"`, `"subtitles"` or `"interface"`, matched on the same `language_supports` row: two of them in one `where` match nothing. `releasedIn` takes the options of the release calendar below: `platforms` and `regions` (one id or several), `includeWorldwide`, `statuses`, `from` and `to`. Worldwide releases count for every region (pass `includeWorldwide: false` to change that), release dates marked Cancelled or Offline are left out unless `statuses` lists them, and release dates without a status, more than half of them, count (`null` in `statuses`). The flip side: `and(g.developedBy(908), g.publishedBy(50))` asks for one company entry that is both, and matches nothing; run two queries instead. `g.platforms.any()` lists every announced platform, cancelled ones included, where `releasedIn({ platforms })` looks at actual release dates. For franchises and series, `g.franchises.any(id)` and `g.collections.any(id)` are enough: the main `franchise` is always in `franchises`, and `collections` matches `collection_memberships` (spin-offs included).

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

`GameType`, `GameStatus`, `GameReleaseFormat`, `Genre`, `Theme`, `GameMode`, `PlayerPerspective`, `Platform`, `PlatformType`, `PlatformFamily`, `ExternalGameSource`, `PopularityType`, `ReleaseDateRegion`, `ReleaseDateStatus`, `DateFormat`, `WebsiteType`, `AgeRatingOrganization`, `AgeRatingCategory`, `Language`, `LanguageSupportType`, `Region` (of `game_localizations`), `CompanyStatus`, `CompanySize`, `CompanyType`, `CollectionType`, `CollectionMembershipType`, `CollectionRelationType`, `NetworkType`, `ImageType`, `ArtworkType`, `CharacterGender` and `CharacterSpecie` are generated from the API. Age ratings repeat across organizations, so their keys start with it: `AgeRatingCategory.PEGI_18`, `AgeRatingCategory.ESRB_M`.

IGDB replaced several fields with reference tables: `games.category` became `game_type`, `release_dates.region` became `release_region`, `external_games.category` became `external_game_source`, and so on. IGDB still accepts the old names but leaves them empty or no longer updates them, so `where category = 0` silently matches nothing. igdb-kit leaves them out of the types and throws a `QueryError` that names the replacement. One exception stays, marked deprecated: IGDB still fills `artworks.artwork_type` on 99.5% of artworks, where its replacement `image_type` is on about half (see `artworkType()` below).

Avoid filters three levels deep, such as `involved_companies.company.name`: IGDB takes 10 to 25 seconds and can time out after about 27. Look the id up first, then filter on `involved_companies.company`; `developedBy()` and `publishedBy()` do it for you.

### Reading results

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

`findByIds()`, `iterate()` and `sync()` size their pages by weight: 500 rows of a light selection, fewer of a heavy one, so that a page stays near `maxBatchBytes` (4 MB). A game with its media, companies, release dates and websites expanded weighs about 20 KB, so such pages hold about 200 games. The weight of a row starts from a cautious guess and is learned from each response. A page IGDB refuses for its size (above 10 MB, or not built within 29 seconds) is asked again in halves. `iterate({ pageSize })` caps the page at 1 to 500 rows. `iterate()` and `sync()` read in id order and throw on any other `sort()`: sort the rows once read. A query with your own `limit` is never split: lower its `limit` if IGDB answers that the response is too large.

### Searching everything

`searchAll()` searches games, characters, collections, platforms and themes at once, through IGDB's `search` endpoint, and returns hits narrowed by `kind`, with the fields you select for each kind:

```ts
const hits = await igdb.searchAll("witcher", {
  kinds: ["game", "character", "collection"],              // default: all five
  select: { game: ["cover.image_id", "first_release_date"], character: ["mug_shot.image_id"] },
  limit: 10,
});
for (const hit of hits) {
  if (hit.kind === "game") hit.game.cover?.image_id;      // { id, name?, cover?, first_release_date? }
  hit.name;                                                // display name, for every kind
  hit.matched;                                             // "name" | "alternative_name"
}
```

IGDB returns the most recently indexed matches first, so last week's mods come before the original (153 of the 381 game matches for "zelda" are mods). `searchAll` leaves out mods, DLCs, bundles, packs, updates and editions by default (`gameTypes`, whose default is `MAIN_GAME_TYPES`, and `includeEditions`), reads every match (500 per request, up to `maxRows`, 2000 by default) and ranks them: exact name, then names starting with the term, then names containing its words, then alternative names; ties go to the most rated games. `order: "igdb"` keeps IGDB's order in a single request. Companies are not in the search index, and rows pointing to deleted entities or to people are dropped. `alternative_name` holds every alternative name joined into one string.

IGDB's search index misses most titles in other languages: it found 26 of 67 localized titles tested ("Wiedźmin 3", "ウィッチャー", "Pokémon Épée", "Layton und das geheimnisvolle Dorf"). With `alternativeTitles` (`"auto"` by default), `searchAll` also looks for the term inside the games' alternative and localized titles, and found 56. These games come after every name match, an exact title first, with `matched: "alternative_name"` and the title in `alternative_name`. It takes one more request, a multiquery: `"auto"` sends it alongside the search when the term has letters of another script than Latin, and after it when fewer than `limit` hits match by name; `true` always sends it, `false` never. The match keeps accents, as IGDB's `~` does: "Pokemon Epee" does not find "Pokémon Épée".

`findByExternalIds()` finds games from their id on Steam, GOG, Epic, Xbox, PlayStation Store… (`ExternalGameSource`), for example to match a Steam library:

```ts
import { ExternalGameSource } from "igdb-kit";

const games = await igdb.games
  .select("name", "cover.image_id")
  .findByExternalIds(ExternalGameSource.Steam, ["292030", "570"]); // Map<string, game>
```

Store ids are strings in IGDB; numbers are accepted. Unknown ids are missing from the map.

### Popularity

`popular()` ranks games by one of IGDB's PopScore metrics and returns them in that order with their score. The query's fields and filters apply to the games, and its `limit` (10 by default) and `offset` pick the page of the ranking; `sort` throws, since the ranking sets the order:

```ts
import { GameType, PopularityType } from "igdb-kit";

const trending = await igdb.games
  .select("name", "cover.image_id")
  .where((g) => g.game_type.eq(GameType.MainGame))
  .limit(20)
  .popular(PopularityType.IGDBPlaying);                  // { game, value }[]
const next = await igdb.games.limit(20).offset(20).popular(PopularityType.IGDBPlaying);
```

The metrics are `IGDBVisits`, `IGDBWantToPlay`, `IGDBPlaying` and `IGDBPlayed`, plus Steam (`Steam24hrPeakPlayers`, `SteamGlobalTopSellers`, `SteamMostWishlistedUpcoming`…) and `Twitch24hrHoursWatched`. Popularity rows are read 500 at a time until enough games pass the filter. The games a filter matches are counted along with the first page: if it falls short and they are at most 10,000, their own rows are read instead, which gives the exact ranking in a few requests (the 20 most visited games released only on Switch 2 take 4 requests, where reading rows in value order found 14 of them in 20). Above 10,000 games, reading stops after `maxRows` rows (5000 by default).

`weightedPopular()` ranks by several metrics at once, paged the same way. Their scales differ by orders of magnitude (IGDB visits top at 0.005, Steam peak players at 0.19), so each is divided by its top value before weighting:

```ts
const top = await igdb.games
  .select("name")
  .limit(20)
  .weightedPopular({ [PopularityType.IGDBWantToPlay]: 0.5, [PopularityType.Steam24hrPeakPlayers]: 0.5 });
// { game, score, values: { 2: 0.0019, 5: null } }[]
```

`values` holds each metric's raw value, and `null` when IGDB has no row for the game: a third of the 500 most played games have no Steam row, which is not the same as a measured 0. Such a game scores 0 for that metric. Negative weights lower a score (`SteamNegativeReviews: -0.2`). Each round reads 500 rows per positively weighted metric, then the other metrics and the games of the new ids, in about 2 multiqueries; it stops as soon as no unread game can enter the top, usually after one round. As with `popular()`, the games a filter matches are counted during the first round: if it does not settle the top and they are at most 10,000, their own rows are scored instead.

IGDB keeps only the latest value of each game and metric, so a trend needs your own history. `popularitySnapshot()` returns rows ready to store, one ranked array per metric:

```ts
for await (const rows of igdb.popularitySnapshot({ limit: 1000 })) {
  await db.insertPopularity(rows); // { game_id, popularity_type, value, rank, calculated_at, external_popularity_source }[]
}
```

Key the history on `game_id`, `popularity_type` and `calculated_at`: each metric is recomputed on its own schedule (IGDB's daily, Steam's and Twitch's on other days), so running a snapshot twice the same day stores nothing new. `limit` reads the 1000 most popular rows of each of the 11 metrics in 3 requests; without it, every row (about 700,000) is read in id order: the metrics are counted, then each one's pages are requested at once, two metrics at a time, for about 145 multiqueries and 40 seconds at the default rate limit. Three metrics are held in memory at most. `types` picks the metrics.

### Release calendar

`releases()` lists the games released in a window, one entry per game however many platforms, regions and statuses it has there:

```ts
import { Platform, ReleaseDateRegion, ReleaseDateStatus } from "igdb-kit";

const october = await igdb.games
  .select("name", "cover.image_id")
  .where((g) => g.game_type.eq(GameType.MainGame))
  .releases({
    from: "2026-10-01",
    to: "2026-11-01",                          // exclusive
    platforms: [Platform.PlayStation5, Platform.PCMicrosoftWindows],
    regions: [ReleaseDateRegion.Europe],       // worldwide releases count too
  });
// { game, release, releases }[], by date
// release: { precision: "day", start: Date, end: Date, year: 2026, month: 10, day: 20, human: "Oct 20, 2026", platform, region, status }
```

`release` is the game's most precise release in the window, then the earliest; `releases` lists them all. IGDB dates are not all days: `precision` is `"day"`, `"month"` (`Oct 2026`), `"quarter"` (`Q4 2026`), `"year"` or `"tbd"`, `start` and `end` bound the period, and `year`, `quarter`, `month` and `day` are set as far as the precision goes (`null` beyond). `releaseDate()` in `igdb-kit/game` returns the same fields. A month, quarter or year is in the window when its whole period is, so `Q4 2026` is in October to December but not in October alone; `match: "overlap"` includes every period that overlaps the window. TBD dates are left out unless `precision` includes `"tbd"`, whatever the window.

Release dates are calendar days at 00:00 UTC, so the window is in UTC days: pass `"YYYY-MM-DD"` strings rather than local midnights. The query's `limit` and `offset`, when set, page the entries. By default Offline and Cancelled dates are left out, and dates without a status, more than half of them, are kept. `statuses: [ReleaseDateStatus.FullRelease, null]` picks statuses, `null` standing for "no status".

A window costs one count, `ceil(dates / 500)` pages read in parallel and `ceil(games / 500)` for the games, packed into multiqueries: a month of upcoming releases (1,700 dates, 1,000 games) takes 3 HTTP requests. Above `maxRows` dates (10,000 by default), it throws instead: page through long periods month by month.

### Data linked to games

Many endpoints point to games without the game pointing back: time to beat and popularity carry a `game_id`, and characters, events, collections and franchises list their `games`. `findByGames()` fetches them for a list of games, grouped by game id. It works on every endpoint with a `game`, `game_id` or `games` field (`GameLinkedEndpoint`), such as `release_dates`, `websites`, `language_supports`, `external_games` or `involved_companies`:

```ts
const timeToBeat = await igdb.game_time_to_beats.select("normally").findByGames([1942, 1020]);
timeToBeat.get(1942); // [{ id: 432, normally: 254778 }]: seconds, about 71 h
timeToBeat.get(1020); // []: no time to beat, the case for most games

const firstDates = await igdb.release_dates.select("date", "platform").sort("date").limit(1).findByGames(ids);
```

Every requested id is in the map, with an empty array when nothing points to the game. Regional covers have no `game` (their game localization points to them), so `covers.findByGames()` returns the main cover only. The query's `where` applies, and its `sort` and `limit` apply to each game's rows. Every row comes back, not just the first 10. A row linked to several of the games, such as a character, is listed under each of them. Ids are sent 500 per query and pages of 500 rows are read until the end, all batched. A page that comes back full is split using the count, so the 9,000 language rows of 500 games take about 9 requests instead of 18 one after the other.

`findBy(field, ids)` does the same through any relation or `..._id` field, on every endpoint. Most of IGDB's links have no field back (95 of 153): a game's editions point to it with `version_parent` while it lists none of them, mods and updates point to it with `parent_game`, and a bundle's content points to it with `bundles`:

```ts
const editions = await igdb.games.select("name", "version_title").findBy("version_parent", [1942, 119133]);
editions.get(1942); // Game of the Year, Complete and Collector's editions
const subsidiaries = await igdb.companies.select("name").findBy("parent", [104]); // Ubisoft's 61 studios
```

### Related games: family, series, catalog

Three `igdb.games` methods read what a game, a series or a company is linked to, with the fields of the query on every game, in release order (undated games last):

```ts
const family = await igdb.games.select("name", "cover.image_id").family(1942); // 1 multiquery of 6 blocks
family.editions; // Game of the Year, Complete, Collector's
family.children; // [{ game, relation: "dlc" | "expansion" | "mod" | "update" | "remake" | "port"... }]
family.bundles; // the bundles that contain it; `contents` lists a bundle's games
family.series; // [{ collection: { id: 62, name: "The Witcher" }, games: [{ game, spinoff }] }]
family.parent; // { id, relation: "edition" | "dlc"..., title } for an edition or a DLC, null here

const zelda = await igdb.games.select("name").series(106, { subseries: true }); // 62 games, 2 requests
const fromSoftware = await igdb.games.select("name").catalog(1012, { roles: ["developer"] }); // 148 games
const ubisoft = await igdb.games.select("name").catalog(104, { includeSubsidiaries: true }); // its studios too
```

`family()` finds what the game's own fields can't show: its editions, and the mods, episodes, seasons, packs and updates that no list of the game holds (`relatedGames()` in `igdb-kit/game` reads the lists it does have, with no request). A series is the editorial line (`collections`, with sub-series, story arcs and spin-off series); a franchise is a wider universe, with editions, packs and crossovers, that `g.franchises.named("Zelda")` filters on. `catalog()` reads `involved_companies` once with each game's roles, about ten times faster than `developedBy()` or `publishedBy()` filters, which stay the way to combine a company with other conditions. These methods read whole lists, so `where`, `search`, `sort`, `limit` and `offset` throw.

To attach the same games to a view, link a `games` query by its field with `linkedBy()`:

```ts
const gamePage = igdb.defineView("games", {
  select: ["name"],
  with: {
    editions: igdb.games.select("name", "version_title").linkedBy("version_parent"),
    children: igdb.games.select("name", "game_type").linkedBy("parent_game"),
  },
});
```

### Views

A view attaches that data to games under names you choose, with a type for the whole result:

```ts
const gamePage = igdb.defineView("games", {
  select: ["name", "cover.image_id", "platforms.name"],
  with: {
    timeToBeat: igdb.game_time_to_beats.select("normally", "completely"),
    characters: igdb.characters.select("name", "mug_shot.image_id"),
    events: igdb.events.select("name", "start_time"),
  },
});

const witcher = await gamePage.findById(1942); // 1 request: the game and its 3 links in one multiquery
// { id; name?; cover?; platforms?; timeToBeat: {...}[]; characters: {...}[]; events: {...}[] } | null
const pages = await gamePage.findByIds(ids);
const top = await gamePage.where((g) => g.rating.gte(90)).sort("rating", "desc").limit(20);
const found = await gamePage.search("zelda").limit(5);
const { data, total } = await gamePage.where((g) => g.developedBy("Nintendo")).limit(20).withCount();
const count = await gamePage.where((g) => g.rating.gte(90)).count(); // games only, one request
```

Like a query, a view sends nothing before it is awaited, and neither do `findById()`, `findByIds()`, `first()` and `withCount()`: pass `signal` or `priority` to their `execute()`. `findById()` and `findByIds()` send the games and the linked queries together: a game with 6 links costs one multiquery (22 KB for The Witcher 3). A list or a search needs the game ids first, so it takes one more request; a `search` is always sent alone. A key can't hide a game field, so name the link to `collection_memberships` `memberships`, not `collections`.

### Expanding ids later

`expand()` replaces ids you already have with the entities they point to, in one batched call. Ids are deduplicated across rows:

```ts
const games = await igdb.games.select("name", "platforms", "genres").limit(500);
const withPlatforms = await igdb.expand(games, "platforms", igdb.platforms.select("name", "abbreviation"));
// platforms?: { id: number; name?: string; abbreviation?: string }[]
```

Each entity is one shared object across rows. Ids of rows that no longer exist are dropped: an event can list a deleted game. Reference tables are loaded whole and kept a day in the client's cache, so expanding them again costs no request. These tables are `platforms`, `genres`, `themes`, `game_modes`, `player_perspectives`, `languages`, `regions`, `game_types`, `release_date_statuses` and the others in `REFERENCE_ENDPOINTS`. Change the duration with the target's `cache(ttlMs)`, or fetch by id with `cache(false)`. A key that IGDB fills with values rather than ids (`tags`, `hypes`, `first_release_date`) throws; keys of your own rows are accepted.

### Reusable selections

`defineSelection()` names a set of fields, checked like `select()`, and `ResultOf<>` gives the type of a selection, a query or a view:

```ts
import { defineSelection, type ResultOf } from "igdb-kit";

export const gameCard = defineSelection("games", "name", "cover.image_id", "platforms.abbreviation");
export type GameCard = ResultOf<typeof gameCard>;

const games = await igdb.games.select(...gameCard, "summary").limit(10);
const gamePage = igdb.defineView("games", { select: [...gameCard, "storyline"], with: { /* ... */ } });
type GamePage = ResultOf<typeof gamePage>;
```

### Copying an endpoint: sync

IGDB encourages keeping your own copy. `sync()` reads every match page by page, in id order:

```ts
const startedAt = new Date();
for await (const page of igdb.games.select("*").sync({ since: lastSync })) {
  await db.upsertGames(page); // up to 500 games
}
lastSync = startedAt; // next time, only what changed since this run
```

The first page goes out with the count. The other pages are then requested in parallel, which batching packs into multiqueries: each asks for the matches after a row already read, skipping those the pages in between hold, so pages come back full however the ids are spread. Matches added or removed meanwhile shift the pages: repeated rows are dropped and rows a page skipped past are read again, so none is missed. A day of changes on `games` (about 33,000) takes 8 requests and 3 seconds, all 73,000 companies with `*` 26 requests and about 11 seconds, and the 133,000 rows of one popularity type, crowded into a few stretches of ids, 28 requests and 7 seconds. At most `concurrency` pages (40 by default, about 64 MB) are requested or waiting to be read, so a slow consumer does not fill the memory. With `since` (a `Date`, a date string or Unix seconds), only entities whose `updated_at` is newer come back. Sync requests run at `background` priority, so interactive queries pass first. Pair it with webhooks to stay up to date between runs.

### Images

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

### Displaying a game: igdb-kit/game

IGDB returns raw rows: several release dates per platform and region, companies with role flags, store ids, rating category ids. `igdb-kit/game` turns a query result into what a page shows, with no request. Each helper requires the fields it reads at compile time (a missing one is an error naming it, such as `select("release_dates.status") is missing`) and accepts any richer selection; `release_dates.*` style wildcards work too.

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

| Helper | Returns | What it handles |
|---|---|---|
| `releaseDate(game, { region?, locale?, platform?, statuses? })` | The date to show, with the fields of a calendar release (`precision`, `start`, `end`, `year`, `quarter`, `month`, `day`, `status`…) and `match` (`exact`, `worldwide`, `other_region`) | Full release first, as IGDB's `first_release_date` does (not early or advanced access), then the region's own row over worldwide. `locale` picks the region from its country (`fr-FR`: Europe, `en-US`: North America, `ja-JP`: Japan), or its likely country when it has none (`fr`: France). Half of the dates have no status: `status` is `null`, and they are not excluded. Quarters and years are stored as the period's last day: `start`, `end` and `precision` place them. |
| `releasesByPlatform(game, { region?, locale? })`, `regionalReleases(game, { platform? })` | One release per platform, or per region, earliest first | For 18% of the 1,000 most popular games, a platform's date changes with the region |
| `formatReleaseDate(release, { locale, dateStyle? })` | `"19 nov. 2026"`, `"T4 2026"`, `"À déterminer"` | IGDB's `human` is always in English. Days and months from `Intl`, quarters and TBD from a table of 13 languages (English otherwise, or your `labels`) |
| `companies(game)` | `{ developers, publishers, porting, supporting }` with your selected company fields | Several regional publishers, a company listed twice |
| `storeLinks(game, { stores?, locale? })`, `localizeStoreUrl(url, locale)` | One link per store product from `websites` and `external_games` | The store comes from the address: archived copies and mistyped links are dropped. Missing URLs are built for Steam, Google Play and single-country Amazon products. With `locale`, PlayStation, Xbox, Epic and GOG pages are in the user's language (99.5% of IGDB's PlayStation links are `en-us`) and Amazon products of other countries are left out. |
| `ageRating(game, organization \| { locale })`, `ageRatings(game)` | `label` (`18`, `M`, `MA 15+`), `minimumAge`, `descriptors`, `synopsis`, or null | Labels and ages for all 40 IGDB categories; two ratings from one organization (the strictest wins). `{ locale }` takes the country's organization, then ESRB and PEGI |
| `localizedName(game, locale)`, `localization(game, locale)` | `{ name, source, language, variant }` | Regional localization (`ja-JP`, `ko-KR`), then an alternative name in the locale's language ("Japanese title", "Chinese title - traditional", "Brazilian title", "UK title" for `en-GB`), then the European title for a European locale, then `name`. Romanizations, abbreviations and unofficial titles are skipped, and so is a name in the wrong script: a "Japanese title" in Latin letters is often a romanization |
| `localizedCover(game, locale)` | `{ image_id, source, region }` | The Japanese, Korean or European box art of the game's localizations, then `cover`. A query of `covers` by game misses these |
| `alternativeTitles(game)`, `parseAlternativeName(comment)` | `{ name, kind, language, variant }` | IGDB's 739 free-text comments ("Japanese title - romanization", "Korean Acroynm", "Steam title"): `kind` is `language`, `regional`, `platform`, `alternative`, `stylized`, `abbreviation`, `working`… and `language` a BCP 47 tag (`zh-Hant`, `pt-BR`). Executable file names are left out |
| `resolveLocale(locale)` | `{ country, releaseRegion, localizationRegions, ageRatingOrganizations, languages }` | What a locale picks in IGDB, used by the `locale` options: `"fr"` is France and Europe, `"en-GB"` prefers `Language.EnglishUK`, `"de-DE"` USK then PEGI and ESRB |
| `languages(game, { locale? })`, `supportsLanguage(game, locale)` | Per language, or for the user's: `audio`, `subtitles`, `interface` | `null` when the game has no data of that kind, `false` when other languages have it. `locale` puts the user's languages first; Spanish (Spain) counts for `es-MX` |
| `releaseRegionName(id, locale)`, `countryName(code, locale)`, `languageName(language, locale)` | `"Amérique du Nord"`, `"France"`, `"chinois simplifié"` | Names from `Intl`. `countryName` reads IGDB's numeric codes (`companies.country`: 250); `languageName` takes a `Language` id or IGDB's `locale` (`"es-MX"` is Latin American Spanish) |
| `eventTime(event, { locale, timeZone? })` | `{ start, end, timeZone, text }` | IGDB's zones are abbreviations (`PST`, `JST`, `CET`) that Bun rejects: they become IANA zones |
| `multiplayer(game, platform?)` | Player counts and co-op flags per platform | 0 means unknown, rows that apply to every platform |
| `parentGame(game)` | `{ relation, game, title }` for editions, DLCs, expansions, remakes, ports... | `version_parent` and `parent_game`, named from `game_type` |
| `timeToBeat(row, { prefer? })`, `formatPlaytime(seconds)` | `{ seconds, kind, count }`, `"71 hr"` | Rows of `game_time_to_beats` (97% of games have none); localized with `Intl` |
| `relatedGames(game)`, `relatedGameFields(...fields)` | `{ parent, dlcs, expansions, standalone_expansions, remakes, remasters, expanded_games, ports, forks, bundles }` | Lists are empty rather than undefined; `relatedGameFields("name")` selects them all with their names. A game's own fields cannot show its editions, mods, episodes, seasons, packs and updates: they point to it and no array lists them |
| `groupByParent(games, { relations? })` | `{ groups: [{ game, members }], missingParents }` | The editions and ports of a list (a company's catalog, search results, a library) under their original. A parent missing from the list is an id to load |
| `franchisesOf(game)` | `{ main, others }` | IGDB sets `franchise` on 1,348 games and `franchises` on 29,259 |
| `externalIds(game, source?)`, `externalId(game, source)` | `[{ source, uid, url }]`, `"292030"` | A game's ids in stores and services, several per source (1,830 games have two or three Steam appids), duplicates dropped. IGDB has no PlayStation trophy ids, only store concept ids, and no Nintendo, Ubisoft, EA or Battle.net source |
| `websiteLinks(game, { kinds? })` | `[{ kind, type, url, trusted }]` | Official site, wikis, social networks and stores, by `kind`. IGDB never marks official sites as trusted, so nothing is dropped for it; social links with no page are |
| `videoLinks(game)` | `[{ kind, name, video_id, url, embedUrl, thumbnailUrl }]` | YouTube links, with `trailer`, `gameplay`, `teaser`, `intro` or `other` read from the name |
| `bestImage(game, { prefer? })` | `{ image_id, source, type, width, height, ratio }` | The cover, else a cover artwork, key art or a screenshot (13% of complete games have no cover). `prefer: "background"` gives a wide image for a banner. Never a logo or an icon |
| `platformVersions(platform, { locale? })` | `[{ version, release, releases }]` | The versions of a console (Slim, Pro, OLED) earliest first, with the date for the user's region |

Data is often missing, and helpers keep "unknown" apart from "no": 79% of games have no age rating, 39% of main games no language data, 94% no multiplayer data. A missing value is `null`, never `undefined`, so results survive `JSON.stringify` (and Next.js props), and references are ids: statuses are `ReleaseDateStatus` ids, store link formats `GameReleaseFormat` ids.

### Translated labels: igdb-kit/i18n

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

- **Tables:** 27 tables by endpoint name (`genres`, `themes`, `game_modes`, `player_perspectives`, `game_types`, `game_statuses`, `release_date_statuses`, `release_date_regions`, `website_types`, `popularity_types`, `company_sizes`, `image_types`, `artwork_types`…) and the 97 content descriptors of the ESRB, PEGI, CERO, GRAC and ClassInd, with descriptions for release statuses and collection types. Platforms, companies and games keep their names: for a game's title in the user's language, see `localizedName()`.
- **Locales:** a locale reads the dictionaries of its language and script, the one of its country first (`fr-CA` reads `fr`, `pt-PT` reads `pt-BR`, `zh-TW` does not read `zh-CN`), then English.
- **New rows:** a row passed as an object (`{ id, name }`) keeps its own English label when its id was added to IGDB after this version; an id alone gives `null`.
- **Your own texts:** a `LabelDictionary` is a plain object. Pass one for another language, or before a built-in one to change some labels: an id it leaves out comes from the next dictionary.

### Batching

Nothing to do: queries started within the same couple of milliseconds are sent together.

```ts
// 1 HTTP request
const [witcher, gta, zelda] = await Promise.all([1942, 1020, 7346].map((id) => igdb.games.select("name").findById(id)));
```

`batch()` makes it explicit and keeps each result's type under its key:

```ts
const { top, total, ps5 } = await igdb.batch({
  top: igdb.games.select("name", "cover.image_id").sort("rating", "desc").limit(5),
  total: igdb.games.where((g) => g.rating.gte(80)).count(),
  ps5: igdb.platforms.select("name").findById(167),
});
// top: { id: number; name?: string; cover?: { id: number; image_id?: string } }[]
// total: number
// ps5: { id: number; name?: string } | null
```

It also takes views, and the `Task` returned by the methods that take several requests, such as `findByIds()`, `findByGames()` or `popular()`: their first requests share the multiquery.

```ts
// 1 HTTP request
const { games, dates } = await igdb.batch({
  games: igdb.games.select("name").findByIds([1942, 1020]),
  dates: igdb.release_dates.select("date", "platform").findByGames([1942]),
});
```

Some queries are always sent alone: `search` queries (IGDB returns an empty multiquery when one block searches), `withCount()` (the total comes from a header multiquery does not have), and any query run with `execute({ batch: false })`. Set `autoBatch: false` to turn automatic grouping off; `batch()` still groups.

### Caching

```ts
const genres = await igdb.genres.select("name").limit(500).cache(24 * 3600_000); // kept a day
```

`cache(ttlMs)` keeps the response so identical queries skip IGDB and the rate limit. Responses live in memory by default, 1,000 of them and 50 MB at most, the least recently used going first; `cache: memoryCache({ maxEntries, maxBytes })` changes these limits, and a response above a quarter of `maxBytes` is not kept. Pass another `cache` to share responses (see Redis below). Set `cacheTtlMs` to cache every query, and `cache(false)` to opt one out. A failing cache store never fails a query.

### Several processes: Redis

IGDB counts the rate limit per client id, and Twitch keeps only 25 active tokens per app. When several processes or servers use the same app, share the token, the quota and the cache through Redis:

```ts
import { createIGDB } from "igdb-kit";
import { redisCache, redisLimiter, redisTokenStore } from "igdb-kit/redis";

const clientId = process.env.TWITCH_CLIENT_ID!;
const igdb = createIGDB({
  clientId,
  clientSecret: process.env.TWITCH_CLIENT_SECRET!,
  tokenStore: redisTokenStore(redis, { clientId }), // one token for every process, renewed by one
  limiter: redisLimiter(redis, { clientId }),       // 4 req/s and 8 in flight across all processes
  cache: redisCache(redis),
});
```

`redis` can be an [ioredis](https://github.com/redis/ioredis) client, a [node-redis](https://github.com/redis/node-redis) client, Bun's `RedisClient`, or a function sending one raw command. igdb-kit depends on none of them.

### Webhooks

IGDB can POST every created, updated or deleted entity to your server. Register at startup: it is idempotent, and it reactivates webhooks IGDB turned off after 5 failed deliveries.

```ts
await igdb.webhooks.ensure({
  url: "https://example.com/igdb",
  secret: process.env.IGDB_WEBHOOK_SECRET!,
  endpoints: ["games", "platforms"], // create, update and delete for each
});
```

Then handle deliveries. `webhookHandler` checks the `X-Secret` header and types each event by endpoint and operation:

```ts
import { webhookHandler } from "igdb-kit/webhooks";

const handler = webhookHandler<"games" | "platforms">({
  secret: process.env.IGDB_WEBHOOK_SECRET!,
  onEvent: async (event) => {
    if (event.operation === "delete") return db.remove(event.endpoint, event.data.id);
    if (event.endpoint === "games") await db.saveGame(event.data); // every field, relations as ids
  },
});

Bun.serve({ routes: { "/igdb": { POST: handler } } }); // or Hono: app.post("/igdb", (c) => handler(c.req.raw))
```

It checks the secret before reading the body, and answers 401 when it is wrong, 413 on a body above `maxBodyBytes` (1 MB by default), and 500 when `onEvent` throws, so IGDB retries. With Express, use `parseWebhook({ headers: req.headers, body: req.body, url: req.url }, secret)`. `igdb.webhooks` also has `register`, `list`, `get`, `delete` and `test`.

### In the browser: proxy

IGDB does not allow CORS, and your client secret must stay on the server. `igdbProxy` forwards the browser's queries through your server's client, with its credentials, rate limit, retries and cache:

```ts
// Server: a catch-all route, e.g. app/api/igdb/[...path]/route.ts in Next.js
import { igdbProxy } from "igdb-kit/proxy";

export const POST = igdbProxy({
  igdb,                                   // your server-side createIGDB() client
  endpoints: ["games", "covers", "platforms", "genres"], // default: all
  maxLimit: 50,                           // default 500
  authorize: (request) => request.headers.has("cookie"), // optional
  cacheTtlMs: 5 * 60_000,                 // optional, uses the client's cache
});
```

```ts
// Browser: the same typed API, no credentials
const igdb = createIGDB({ proxyUrl: "/api/igdb" });
const games = await igdb.games.select("name", "cover.image_id").search("zelda").limit(10);
```

The last path segment names the endpoint (`games`, `games/count`, `multiquery`), so batching keeps working. Only Apicalypse reads are forwarded, never the webhooks API. A refused query (endpoint not allowed, `limit` above `maxLimit`, `authorize` returning false) throws a `QueryError` in the browser. `authorize` runs before the body is read, and a body above `maxBodyBytes` (16 KB by default) is answered 413 as soon as it passes the limit. The browser client keeps its multiqueries under 16 KB, and a single query that large throws a `PayloadTooLargeError`; if you raise the proxy's `maxBodyBytes`, pass the same value to `createIGDB`. For another origin, pass `allowOrigin`; `cacheControl` sets the `Cache-Control` header of answers.

### Errors

All errors extend `IGDBError` and carry `status`, `endpoint`, `details` (IGDB's own error entries) and the `query` that failed.

| Error | When |
|---|---|
| `QueryError` | Invalid field, syntax or type error, `limit` above 500 (IGDB answers 403 for that), unknown endpoint |
| `PayloadTooLargeError` | The response would exceed IGDB's 10 MB cap, or the request body exceeds 32,000 bytes: the message says which |
| `QueryTimeoutError` | IGDB gave up after about 27 s (408) |
| `TierError` | Data outside your API access tier (the `content_safety_*` endpoints) |
| `AuthError` | Bad credentials, or a token still refused after one renewal |
| `RateLimitError` | Still 429 when the retry budget ran out |
| `NotFoundError` | `findByIdOrThrow()` or `firstOrThrow()` found nothing, or a name in `named()`, `developedBy()` or `publishedBy()` matches nothing (`suggestions` lists close names) |
| `NetworkError` | 5xx or network failure that persisted |
| `IGDBError` | A response that is not JSON, such as a `proxyUrl` answering with an HTML page |

429, 5xx and network errors are retried with backoff until `retryTimeoutMs` (30 s by default) runs out. Every request accepts an `AbortSignal`: `query.execute({ signal })`.

### Options

```ts
createIGDB({
  clientId,
  clientSecret,               // or accessToken: a token you manage (never renewed)
  tokenStore,                 // { get, set, delete, lock? }; default in memory
  limiter,                    // LocalLimiterOptions or your own Limiter; shared per clientId, first options win
  retryTimeoutMs: 30_000,
  attemptTimeoutMs: 30_000,
  autoBatch: true,            // group concurrent queries into multiqueries
  batchWindowMs: 2,           // how long to wait for more queries before sending
  maxBatchBytes: 4_000_000,   // target size of one multiquery response, and of a page
  maxBodyBytes: 32_000,       // largest multiquery body; 16_384 with proxyUrl, like igdbProxy
  cache,                      // CacheStore for cache()d queries; default in memory
  cacheTtlMs,                 // cache every query this long; default only cache()d ones
  hooks: { onRequest, onRetry, onRateLimited, onTokenRefresh },
});
```

`hooks.onRequest` is called after every request, for logs and metrics: `{ path, method, status, durationMs, bytes, attempt, blocks, cached }`, where `status` is 0 when no answer came, `attempt` counts retries from 1, `blocks` is the number of queries in a multiquery and `cached` marks a response read from the cache. What it throws is ignored.

```ts
const igdb = createIGDB({
  clientId,
  clientSecret,
  hooks: { onRequest: (r) => console.log(`${r.path} ${r.status} ${r.durationMs} ms ${r.bytes} B${r.cached ? " cached" : ""}`) },
});
```

Requests can be marked `priority: "background"` so they wait behind `interactive` ones, for example during a sync.

## Conventions

The same rules hold across the library:

- **Names.** IGDB's data keeps IGDB's names, in snake_case: endpoints, fields and the rows they return (`release_dates`, `first_release_date`). What igdb-kit adds is in camelCase: methods, options and computed objects (`findByGames()`, `includeWorldwide`, `minimumAge`). A row meant to be stored keeps IGDB's columns, such as `calculated_at` in `popularitySnapshot()`.
- **Methods.** An endpoint only has the methods that work on it. `igdb.games` is a `GamesQuery`, with `popular()`, `weightedPopular()`, `releases()`, `findByExternalIds()`, `family()`, `series()` and `catalog()`; the 24 endpoints whose rows point to games, such as `release_dates` or `characters`, are `GameLinkedQuery`s, with `findByGames()`; the others are plain `Query`s. Every query has `findBy()`. `QueryOf<"release_dates">` names the type of an endpoint, and `select()`, `where()` and the other builder methods keep it.
- **Placement.** A method that returns an endpoint's rows is on that endpoint, even when it reads others along the way (`igdb.games.popular()`, `igdb.release_dates.findByGames()`). The rest is on the client (`igdb.batch()`, `igdb.searchAll()`, `igdb.expand()`, `igdb.popularitySnapshot()`). Helpers that send no request are in `igdb-kit/game`, and server pieces in `igdb-kit/proxy`, `igdb-kit/redis` and `igdb-kit/webhooks`.
- **Laziness.** Nothing is sent before it is awaited or executed: queries, views, and the `Task` returned by the methods that take several requests (`findByIds()`, `findByGames()`, `findBy()`, `findByExternalIds()`, `popular()`, `weightedPopular()`, `releases()`, `family()`, `series()`, `catalog()`, `searchAll()`, `expand()`). All of them go in `batch()`, and request options (`signal`, `priority`, `batch`) go to their `execute()`. A task is typed as a promise and sends its requests once, however many times it is awaited; `execute()` sends them again. `iterate()`, `sync()` and `popularitySnapshot()`, read with `for await`, take the request options among their own. `batch()`, `raw()` and the `webhooks` methods send at once.
- **Options.** `limit` is the number of results (10 by default, 500 at most; `popularitySnapshot()` takes it per metric), `offset` skips results, `pageSize` is the number of rows of a page read by `iterate()`, `concurrency` the pages `sync()` requests at once, and `maxRows` caps the rows read: a method that ranks (`popular()`, `weightedPopular()`, `searchAll()`) returns the best it found within it, and `releases()`, which lists everything, throws rather than return part of the list. Options that filter on ids have plural names and take one id or several (`platforms`, `regions`, `statuses`, `gameTypes`, `types`); `releaseDate()` takes one `platform` and one `region`, since they choose the date to show rather than filter. A boolean that widens a filter starts with `include` (`includeWorldwide`, `includeEditions`).
- **Dates.** A date argument takes a `Date`, a `"YYYY-MM-DD"` or ISO string, or Unix seconds (`DateInput`), and a number in milliseconds such as `Date.now()` throws a `QueryError`. Rows keep IGDB's Unix seconds, and computed objects give `Date`s (`start` and `end` of a release).
- **Missing values.** A row leaves out the fields IGDB leaves out. A computed object has all its keys, with `null` where there is no value, so that it survives `JSON.stringify` and Next.js props, and a lookup that finds nothing returns `null` (`first()`, `findById()`, `releaseDate()`). `imageUrl()` is the exception: it returns `undefined` without an image, which `<img src>` accepts.
- **Reference values.** IGDB ids everywhere, in options and in computed objects, read and written with the generated constants (`Platform.NintendoSwitch`, `ReleaseDateStatus.FullRelease`). Strings are for igdb-kit's own notions: `precision`, `match`, `store`, `relation`, `kind`.
- **Read-only rows.** Identical queries sent at the same time share one response, so treat rows as read-only: igdb-kit never changes a row it received.
- **Errors.** A `QueryError` for anything wrong with a query, whether igdb-kit finds it before sending or IGDB rejects the query; a `NotFoundError` for `*OrThrow()` and a company name that matches nothing; a `TypeError` for a wrong argument outside any query, such as something that is not an image id. An `IGDBError` carries the `endpoint` and the `query` it comes from.
- **Renames.** A renamed method or option, or a replaced way to pass options, keeps working for one minor version, marked deprecated so that editors strike it through.

## Compatibility

Node.js 20 or later, and Bun; browsers through `igdb-kit/proxy`. ESM and CommonJS. Types are tested on TypeScript 5.9, 6.0 and 7.0.

## Changelog

What changed in each version is in [CHANGELOG.md](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/CHANGELOG.md), also published as [GitHub releases](https://github.com/7IBO/igdb-kit/releases).

## Development

```sh
bun install
bun run codegen          # regenerate src/generated/schema.ts (--fetch downloads the latest proto and reference tables, with Twitch credentials)
bun run audit            # check every field against the live API (types, unknown fields), with Twitch credentials
bun run test             # unit tests
bun run test:types       # compile-time inference tests
bun run bench:types      # type-checking cost per query on each TypeScript version
TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… bun run --filter igdb-kit test:integration
REDIS_URL=redis://localhost:6379 bun run --filter igdb-kit test:redis
```
