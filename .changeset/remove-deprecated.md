---
"igdb-kit": minor
---

Breaking: the names and forms deprecated in 0.5.0 are removed.

- Request options go to the task's `execute()` only: `findByIds(ids).execute({ signal })`. They are no longer accepted as the last argument of `findByIds()`, `findByGames()`, `findByExternalIds()`, `igdb.expand()` and a view's `findById()`, `findByIds()` and `first()`, nor among the options of `popular()`, `weightedPopular()`, `releases()` and `searchAll()`.
- `popular()` and `weightedPopular()` take their page from the query only: `igdb.games.limit(20).popular(type)`; their `limit` option is removed.
- `byGame()` is removed: use `findByGames()`.
- `searchAll({ editions })` is removed: use `includeEditions`.
- `popularitySnapshot({ top })` is removed: use `limit`.
- `SEARCH_GAME_TYPES` is removed: use `MAIN_GAME_TYPES`.
- `g.releasedIn()` loses `platform`, `region`, `worldwide` and `includeCancelled`: use `platforms`, `regions`, `includeWorldwide`, and `statuses` to keep cancelled or offline release dates.
- `timeToBeat(row, kinds)` is removed: use `timeToBeat(row, { prefer: kinds })`.
- `releaseDate()` loses `date` and `statusId` (use `start` and `status`), and `statuses` takes `ReleaseDateStatus` ids only; the `ReleaseStatus` type is removed.

`g.playableTogether()`, new in this version, takes `platforms` like the other filters.
