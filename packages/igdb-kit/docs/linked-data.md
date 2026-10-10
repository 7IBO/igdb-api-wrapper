# Linked data

- [Rows that point to games: `findByGames()` and `findBy()`](#rows-that-point-to-games-findbygames-and-findby)
- [Related games: `family()`, `series()`, `catalog()`](#related-games-family-series-catalog)
- [Views](#views): a game and its linked data in one typed result
- [Expanding ids later: `expand()`](#expanding-ids-later-expand)
- [Reusable selections](#reusable-selections)

## Rows that point to games: findByGames() and findBy()

Many endpoints point to games without the game pointing back: time to beat and popularity carry a `game_id`, and characters, events, collections and franchises list their `games`. `findByGames()` fetches them for a list of games, grouped by game id. It works on every endpoint with a `game`, `game_id` or `games` field (`GameLinkedEndpoint`), such as `release_dates`, `websites`, `language_supports`, `external_games` or `involved_companies`:

```ts
const timeToBeat = await igdb.game_time_to_beats.select("normally").findByGames([1942, 1020]);
timeToBeat.get(1942); // [{ id: 432, normally: 254778 }]: seconds, about 71 h
timeToBeat.get(1020); // []: no time to beat, the case for most games

const firstDates = await igdb.release_dates.select("date", "platform").sort("date").limit(1).findByGames(ids);
```

- Every requested id is in the map, with an empty array when nothing points to the game.
- The query's `where` applies, and its `sort` and `limit` apply to each game's rows. Every row comes back, not just the first 10. A row linked to several of the games, such as a character, is listed under each of them.
- Regional covers have no `game` (their game localization points to them), so `covers.findByGames()` returns the main cover only.
- Ids are sent 500 per query and pages of 500 rows are read until the end, all batched. A page that comes back full is split using the count, so the 9,000 language rows of 500 games take about 9 requests instead of 18 one after the other.

`findBy(field, ids)` does the same through any relation or `..._id` field, on every endpoint. Most of IGDB's links have no field back (95 of 153): a game's editions point to it with `version_parent` while it lists none of them, mods and updates point to it with `parent_game`, and a bundle's content points to it with `bundles`:

```ts
const editions = await igdb.games.select("name", "version_title").findBy("version_parent", [1942, 119133]);
editions.get(1942); // Game of the Year, Complete and Collector's editions
const subsidiaries = await igdb.companies.select("name").findBy("parent", [104]); // Ubisoft's 61 studios
```

## Related games: family, series, catalog

Three `igdb.games` methods read what a game, a series or a company is linked to, with the fields of the query on every game, in release order (undated games last):

```ts
const family = await igdb.games.select("name", "cover.image_id").family(1942); // 1 multiquery of 6 blocks, null for an unknown id
family?.editions; // Game of the Year, Complete, Collector's
family?.children; // [{ game, relation: "dlc" | "expansion" | "mod" | "update" | "remake" | "port"... }]
family?.bundles; // the bundles that contain it; `contents` lists a bundle's games
family?.series; // [{ collection: { id: 62, name: "The Witcher" }, games: [{ game, spinoff }] }]
family?.parent; // { id, relation: "edition" | "dlc"..., title } for an edition or a DLC, null here

const zelda = await igdb.games.select("name").series(106, { subseries: true }); // 62 games, 2 requests
const fromSoftware = await igdb.games.select("name").catalog(1012, { roles: ["developer"] }); // 148 games
const ubisoft = await igdb.games.select("name").catalog(104, { includeSubsidiaries: true }); // its studios too
```

- **`family()`** finds what the game's own fields can't show: its editions, and the mods, episodes, seasons, packs and updates that no list of the game holds. [`relatedGames()`](display.md#related-games) in `igdb-kit/game` reads the lists it does have, with no request.
- **`series()`** reads a series, the editorial line (`collections`, with sub-series, story arcs and spin-off series). A franchise is a wider universe, with editions, packs and crossovers, that `g.franchises.named("Zelda")` filters on.
- **`catalog()`** reads `involved_companies` once with each game's roles, about ten times faster than `developedBy()` or `publishedBy()` filters, which stay the way to combine a company with other conditions.

These methods read whole lists, so `where`, `search`, `sort`, `limit` and `offset` throw.

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

## Views

A view attaches linked data to games under names you choose, with a type for the whole result:

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

Like a query, a view sends nothing before it is awaited, and neither do `findById()`, `findByIds()`, `first()` and `withCount()`: pass `signal` or `priority` to their `execute()`.

`findById()` and `findByIds()` send the games and the linked queries together: a game with 6 links costs one multiquery (22 KB for The Witcher 3). A list or a search needs the game ids first, so it takes one more request; a `search` is always sent alone. A key can't hide a game field, so name the link to `collection_memberships` `memberships`, not `collections`.

## Expanding ids later: expand()

`expand()` replaces ids you already have with the entities they point to, in one batched call. Ids are deduplicated across rows:

```ts
const games = await igdb.games.select("name", "platforms", "genres").limit(500);
const withPlatforms = await igdb.expand(games, "platforms", igdb.platforms.select("name", "abbreviation"));
// platforms?: { id: number; name?: string; abbreviation?: string }[]
```

Each entity is one shared object across rows. Ids of rows that no longer exist are dropped: an event can list a deleted game.

Reference tables are loaded whole and kept a day in the client's cache, so expanding them again costs no request. These tables are `platforms`, `genres`, `themes`, `game_modes`, `player_perspectives`, `languages`, `regions`, `game_types`, `release_date_statuses` and the others in `REFERENCE_ENDPOINTS`. Change the duration with the target's `cache(ttlMs)`, or fetch by id with `cache(false)`.

A key that IGDB fills with values rather than ids (`tags`, `hypes`, `first_release_date`) throws; keys of your own rows are accepted.

## Reusable selections

`defineSelection()` names a set of fields, checked like `select()`, and `ResultOf<>` gives the type of a selection, a query or a view:

```ts
import { defineSelection, type ResultOf } from "igdb-kit";

export const gameCard = defineSelection("games", "name", "cover.image_id", "platforms.abbreviation");
export type GameCard = ResultOf<typeof gameCard>;

const games = await igdb.games.select(...gameCard, "summary").limit(10);
const gamePage = igdb.defineView("games", { select: [...gameCard, "storyline"], with: { /* ... */ } });
type GamePage = ResultOf<typeof gamePage>;
```
