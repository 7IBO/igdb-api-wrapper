---
"igdb-kit": minor
---

Dates are taken the same way everywhere: a `Date`, a `"YYYY-MM-DD"` or ISO string, or Unix seconds (the `DateInput` type), in `where` on every timestamp field, `releasedIn()`, `releases()`, `sync({ since })` and `toUnix()`. A number in milliseconds, such as `Date.now()`, throws a `QueryError` instead of silently matching nothing. Timestamp filters gain `between(from, to)`, on or after `from` and before `to`.

`popular()` and `weightedPopular()` take their page from the query, like any other read: `igdb.games.limit(20).offset(20).popular(type)`. The `limit` option still works and is deprecated. `releases()` pages its entries with the query's `limit` and `offset` when they are set.

Breaking changes:

- `sync({ since })` took a number of milliseconds; it now takes Unix seconds, like IGDB's `updated_at`, and throws on milliseconds. A `Date` works in both versions.
- `popular()`, `weightedPopular()` and `releases()` ignored the query's `limit`, `offset` and `sort`. The first two now return the query's `limit` games (10 by default) from its `offset`, `releases()` applies them when set, and a `sort()` throws, since these methods set the order.
