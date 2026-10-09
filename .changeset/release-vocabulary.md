---
"igdb-kit": minor
---

Release dates share one vocabulary. `g.releasedIn()` takes the options of `releases()` (the `ReleaseFilter` type): `platforms` and `regions` (one id or several), `includeWorldwide`, `statuses` (`ReleaseDateStatus` ids, `null` for "no status"), `from` and `to`. Its `platform`, `region`, `worldwide` and `includeCancelled` options still work and are deprecated. `releases()` takes a single id as well as a list. A calendar release and `releaseDate()` now return the same fields, worked out by one module: `precision`, `start`, `end`, `year`, `quarter`, `month`, `day`, `human`, `platform`, `region` and `status`. `releaseDate()` gains `locale`, which picks the region from the user's country (`fr-FR`: Europe, `en-US`: North America). `timeToBeat(row, { prefer })` replaces `timeToBeat(row, prefer)`, which still works and is deprecated.

`igdb-kit/game` follows the conventions of the rest of the library: a missing value is `null`, never `undefined`, so results survive `JSON.stringify` and Next.js props, and references are ids.

Breaking changes:

- `releaseDate()`: `status` is the `ReleaseDateStatus` id, `null` without one, instead of a name. `statuses` takes ids; the names still work and are deprecated. `date` and `statusId` are deprecated: use `start` and `status`.
- `null` instead of `undefined` in `releaseDate()`, `ageRating()` (`label`, `minimumAge`, `synopsis`), `languages()`, `multiplayer()`, `parentGame()` (`title`), `timeToBeat()` (`count`), `formatPlaytime()`, `localization()`, `storeOf()`, `storeLinks()` (`trusted`, `platform`, `countries`) and `artworkType()`.
- `StoreLink.format` is the `GameReleaseFormat` id instead of `"digital"` or `"physical"`.
