# Finding games

- [By text: `searchAll()`](#by-text-searchall), across games, characters, series, platforms and themes, in every language
- [By store id: `findByExternalIds()`](#by-store-id-findbyexternalids), from a Steam, GOG, Epic or Xbox library
- [By title: `games.match()`](#by-title-gamesmatch), from a store or list title without an id IGDB knows

## By text: searchAll()

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

IGDB returns the most recently indexed matches first, so last week's mods come before the original (153 of the 381 game matches for "zelda" are mods). `searchAll` corrects that:

- It leaves out mods, DLCs, bundles, packs, updates and editions by default (`gameTypes`, whose default is `MAIN_GAME_TYPES`, and `includeEditions`).
- It reads every match (500 per request, up to `maxRows`, 2000 by default) and ranks them: exact name, then names starting with the term, then names containing its words, then alternative names; ties go to the most rated games. `order: "igdb"` keeps IGDB's order in a single request.
- Companies are not in the search index, and rows pointing to deleted entities or to people are dropped. `alternative_name` holds every alternative name joined into one string.

### Titles in other languages

IGDB's search index misses most titles in other languages: it found 26 of 67 localized titles tested ("Wiedźmin 3", "ウィッチャー", "Pokémon Épée", "Layton und das geheimnisvolle Dorf"). With `alternativeTitles` (`"auto"` by default), `searchAll` also looks for the term inside the games' alternative and localized titles, and found 56. These games come after every name match, an exact title first, with `matched: "alternative_name"` and the title in `alternative_name`.

It takes one more request, a multiquery: `"auto"` sends it alongside the search when the term has letters of another script than Latin, and after it when fewer than `limit` hits match by name; `true` always sends it, `false` never. The match keeps accents, as IGDB's `~` does: "Pokemon Epee" does not find "Pokémon Épée".

## By store id: findByExternalIds()

`findByExternalIds()` finds games from their id on Steam, GOG, Epic, Xbox, PlayStation Store… (`ExternalGameSource`), for example to match a Steam library:

```ts
import { ExternalGameSource } from "igdb-kit";

const games = await igdb.games
  .select("name", "cover.image_id")
  .findByExternalIds(ExternalGameSource.Steam, ["292030", "570"]); // Map<string, game>
```

Store ids are strings in IGDB; numbers are accepted. Unknown ids are missing from the map.

## By title: games.match()

For a title without a store id IGDB knows, such as most PlayStation trophy lists and Xbox titles, `games.match()` returns the games it may be, best first, each with a score from 0 to 1:

```ts
const [best, next] = await igdb.games
  .select("name")
  .match({ name: "DARK SOULS™ III", platforms: ["PS4"], year: 2016 }); // platforms: ids or names
// best: { game: { id: 11133, name: "Dark Souls III" }, score: 1, title: "Dark Souls III", matched: "name" }
if (best && best.score >= 0.95 && (next?.score ?? 0) < best.score) save(best.game.id);
```

It looks in names, alternative names and localized titles ("Pokémon Épée" finds Pokémon Sword with `matched: "alternative_name"` and 0.97), ignores trademark signs, punctuation, accents and case, reads "VII" as "7", and also tries the title without its edition or platform label: "The Witcher® 3: Wild Hunt - GOTY Edition" finds the Game of the Year Edition with 1, then the game with 0.95. Below 0.9 a title only resembles the name.

- `platforms` and `year` lower the games that disagree (times 0.7 on none of the platforms, 0.9 or 0.6 a year or more apart): without them, the 2016 Doom and the 1993 one both score 1 for "DOOM", and the next candidate tells you so.
- Mods, forks and updates are scored times 0.9; equal scores go to full games before DLCs and packs, then to games before their editions, then to the most rated.
- The query's `limit` (default 5) caps the candidates and `minScore` (0.5) drops the weakest.

It costs two to four requests: the title searched as is and without punctuation or edition (IGDB's search finds nothing for "NieR:Automata"), a multiquery for the equal names, alternative names and localized titles, then the candidates when you select fields beyond `name`, `game_type`, `version_parent`, `first_release_date`, `platforms` and `total_rating_count`, or filter with `where`.
