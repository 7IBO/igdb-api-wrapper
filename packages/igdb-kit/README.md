# igdb-kit

[![npm](https://img.shields.io/npm/v/igdb-kit)](https://www.npmjs.com/package/igdb-kit)
[![CI](https://github.com/7IBO/igdb-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/7IBO/igdb-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/igdb-kit)](https://github.com/7IBO/igdb-kit/blob/main/LICENSE)

A fully typed [IGDB](https://api-docs.igdb.com/) API client for Node.js and Bun, and for the browser through your own proxy.

- **Exact result types.** The type of every response is inferred from the fields you select, and field paths are checked at compile time and again before the request leaves.
- **Generated from the official schema.** All 84 endpoints, with descriptions, named ids for reference tables (`Platform.PlayStation5`) and none of the fields IGDB stopped filling.
- **Requests handled for you.** A shared rate limit that backs off after a 429, tokens renewed before they expire, and concurrent queries grouped into multiqueries automatically.
- **Helpers for real pages.** Search in every language, match store titles, family and series of a game, popularity, release calendar, and display helpers that follow the user's locale.

> Versions 0.x may change the API between minor releases. See the [changelog](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/CHANGELOG.md).

## Install

```sh
npm install igdb-kit
# or
bun add igdb-kit
```

You need a Twitch application: create one in the [Twitch developer console](https://dev.twitch.tv/console/apps) and use its client id and client secret. The client secret must stay on the server.

## Quick start

```ts
import { createIGDB } from "igdb-kit";

const igdb = createIGDB({
  clientId: process.env.TWITCH_CLIENT_ID!,
  clientSecret: process.env.TWITCH_CLIENT_SECRET!,
});

const games = await igdb.games
  .select("name", "rating", "cover.image_id", "platforms.name", "genres")
  .where((g) => g.rating.gte(80).and(g.platforms.named("PS5", "Switch")))
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

Queries are immutable and awaitable, and every endpoint is on the client: `igdb.games`, `igdb.platforms`, `igdb.release_dates`… Each field only offers the operators that fit its type. See [Queries](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/queries.md).

## A quick tour

**Find games** by text in any language, by store id, or by a store title without an id ([Finding games](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/finding-games.md)):

```ts
import { ExternalGameSource } from "igdb-kit";

await igdb.searchAll("ウィッチャー");             // The Witcher 3, found by its Japanese title
await igdb.games.select("name").findByExternalIds(ExternalGameSource.Steam, ["292030"]); // Map { "292030" => game }
await igdb.games.select("name").match({ name: "DARK SOULS™ III", platforms: ["PS4"], year: 2016 }); // [{ game, score: 1 }, ...]
```

**Read what is linked to a game**: editions, DLCs, bundles, series, a company's catalog, or any rows that point to games ([Linked data](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/linked-data.md)):

```ts
const family = await igdb.games.select("name").family(1942); // { editions, children, bundles, series, parent }
const timeToBeat = await igdb.game_time_to_beats.select("normally").findByGames([1942, 1020]); // Map by game id
```

**Rank and list games** by popularity or release date ([Popularity](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/popularity.md), [Release calendar](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/releases.md)):

```ts
import { PopularityType } from "igdb-kit";

const trending = await igdb.games.select("name").limit(20).popular(PopularityType.IGDBPlaying);
const october = await igdb.games.select("name").releases({ from: "2026-10-01", to: "2026-11-01" });
```

**Show a game in the user's language** with helpers that send no request: title, release date, age rating, store links, and IGDB's labels in 9 languages ([Displaying a game](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/display.md), [Languages](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/languages.md)):

```ts
import { formatReleaseDate, localizedName, releaseDate } from "igdb-kit/game";
import { createLabels } from "igdb-kit/i18n";
import { fr } from "igdb-kit/i18n/fr";

const game = await igdb.games
  .select("name", "genres", "release_dates.*", "game_localizations.name", "game_localizations.region",
    "alternative_names.name", "alternative_names.comment")
  .findByIdOrThrow(1942);

localizedName(game, "ja-JP")?.name;                           // "ウィッチャー3 ワイルドハント"
const release = releaseDate(game, { locale: "fr-FR" });
if (release) formatReleaseDate(release, { locale: "fr-FR" });   // "19 mai 2015"
const { label } = createLabels([fr]);
game.genres?.map((genre) => label("genres", genre, "fr"));    // ["Jeu de rôle (RPG)", "Aventure"]
```

**Keep a local copy** up to date with `sync()`, webhooks and `removed()`, and generate its tables from `igdb-kit/schema` ([Keeping a local copy](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/local-copy.md)).

**Run it on servers**: explicit `batch()`, caching, Redis to share the token and the rate limit across processes, and a proxy for the browser ([Client, batching and servers](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/client.md)).

## Documentation

| Page | Covers |
|---|---|
| [Queries](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/queries.md) | Selecting fields, filters, relations by name, named filters on games, reference ids, dates, reading and paging results |
| [Finding games](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/finding-games.md) | `searchAll()`, titles in other languages, `findByExternalIds()`, `games.match()` |
| [Linked data](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/linked-data.md) | `findByGames()`, `findBy()`, `family()`, `series()`, `catalog()`, views, `expand()`, reusable selections |
| [Popularity](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/popularity.md) | `popular()`, `weightedPopular()`, `popularitySnapshot()` |
| [Release calendar](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/releases.md) | `releases()`, date precision, regions and statuses |
| [Displaying a game](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/display.md) | Every helper of `igdb-kit/game`, image URLs |
| [Languages](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/languages.md) | Everything that follows a locale, `resolveLocale()`, translated labels in `igdb-kit/i18n` |
| [Keeping a local copy](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/local-copy.md) | `sync()`, webhooks, `removed()`, `igdb-kit/schema` |
| [Client, batching and servers](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/client.md) | Rate limit and tokens, options, hooks, `batch()`, caching, Redis, browser proxy, errors |
| [Conventions](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/docs/conventions.md) | The naming, laziness, options, dates and missing values rules the whole API follows |

## Entry points

| Import | Contents |
|---|---|
| `igdb-kit` | `createIGDB()`, queries, filters, generated types and ids, `imageUrl()`, errors |
| `igdb-kit/game` | Helpers that turn a query result into what a page shows, with no request |
| `igdb-kit/i18n` | `createLabels()`; the languages are in `igdb-kit/i18n/fr`, `/de`, `/es`, `/pt-BR`, `/pl`, `/ru`, `/ja` and `/zh-CN` |
| `igdb-kit/schema` | Every endpoint's fields as data, and the JSON Schema of a row |
| `igdb-kit/proxy` | `igdbProxy()`, to query IGDB from the browser through your server |
| `igdb-kit/redis` | A token store, a rate limiter and a cache shared through Redis |
| `igdb-kit/webhooks` | `webhookHandler()` and `parseWebhook()` |

## Compatibility

Node.js 20 or later, and Bun; browsers through `igdb-kit/proxy`. ESM and CommonJS. Types are tested on TypeScript 5.9, 6.0 and 7.0.

## Changelog

What changed in each version is in [CHANGELOG.md](https://github.com/7IBO/igdb-kit/blob/main/packages/igdb-kit/CHANGELOG.md), also published as [GitHub releases](https://github.com/7IBO/igdb-kit/releases). To work on igdb-kit itself, see [CONTRIBUTING.md](https://github.com/7IBO/igdb-kit/blob/main/CONTRIBUTING.md).
