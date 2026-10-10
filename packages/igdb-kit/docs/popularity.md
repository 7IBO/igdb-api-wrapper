# Popularity

- [`popular()`](#popular): games ranked by one PopScore metric
- [`weightedPopular()`](#weightedpopular): games ranked by several metrics at once
- [`popularitySnapshot()`](#popularitysnapshot): rows to store, to build a history

## popular()

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

The metrics are `IGDBVisits`, `IGDBWantToPlay`, `IGDBPlaying` and `IGDBPlayed`, plus Steam (`Steam24hrPeakPlayers`, `SteamGlobalTopSellers`, `SteamMostWishlistedUpcoming`…) and `Twitch24hrHoursWatched`.

Popularity rows are read 500 at a time until enough games pass the filter. The games a filter matches are counted along with the first page: if it falls short and they are at most 10,000, their own rows are read instead, which gives the exact ranking in a few requests (the 20 most visited games released only on Switch 2 take 4 requests, where reading rows in value order found 14 of them in 20). Above 10,000 games, reading stops after `maxRows` rows (5000 by default).

## weightedPopular()

`weightedPopular()` ranks by several metrics at once, paged the same way. Their scales differ by orders of magnitude (IGDB visits top at 0.005, Steam peak players at 0.19), so each is divided by its top value before weighting:

```ts
const top = await igdb.games
  .select("name")
  .limit(20)
  .weightedPopular({ [PopularityType.IGDBWantToPlay]: 0.5, [PopularityType.Steam24hrPeakPlayers]: 0.5 });
// { game, score, values: { 2: 0.0019, 5: null } }[]
```

`values` holds each metric's raw value, and `null` when IGDB has no row for the game: a third of the 500 most played games have no Steam row, which is not the same as a measured 0. Such a game scores 0 for that metric. Negative weights lower a score (`SteamNegativeReviews: -0.2`).

Each round reads 500 rows per positively weighted metric, then the other metrics and the games of the new ids, in about 2 multiqueries; it stops as soon as no unread game can enter the top, usually after one round. As with `popular()`, the games a filter matches are counted during the first round: if it does not settle the top and they are at most 10,000, their own rows are scored instead.

## popularitySnapshot()

IGDB keeps only the latest value of each game and metric, so a trend needs your own history. `popularitySnapshot()` returns rows ready to store, one ranked array per metric:

```ts
for await (const rows of igdb.popularitySnapshot({ limit: 1000 })) {
  await db.insertPopularity(rows); // { game_id, popularity_type, value, rank, calculated_at, external_popularity_source }[]
}
```

Key the history on `game_id`, `popularity_type` and `calculated_at`: each metric is recomputed on its own schedule (IGDB's daily, Steam's and Twitch's on other days), so running a snapshot twice the same day stores nothing new.

`limit` reads the 1000 most popular rows of each of the 11 metrics in 3 requests. Without it, every row (about 700,000) is read in id order: the metrics are counted, then each one's pages are requested at once, two metrics at a time, for about 145 multiqueries and 40 seconds at the default rate limit. Three metrics are held in memory at most. `types` picks the metrics.
