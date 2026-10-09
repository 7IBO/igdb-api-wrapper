---
"igdb-kit": minor
---

The methods that take several requests wait to be awaited, like queries: `findByIds()`, `findByGames()` (and `byGame()`), `findByExternalIds()`, `popular()`, `weightedPopular()`, `releases()`, `igdb.searchAll()` and `igdb.expand()` return a `Task`, typed as a promise of their result. `igdb.batch()` takes tasks and views along with queries, and the first requests of everything in it share one multiquery. Request options (`signal`, `priority`, `batch`) go to the task's `execute()`: `igdb.games.popular(type).execute({ signal })`. Passing them as the last argument (`findByIds(ids, { signal })`) or among the method's options (`popular(type, { signal })`) still works and is deprecated.

Breaking changes:

- These methods start their requests when the task is awaited, not when they are called. A task sends them once however many times it is awaited, and `execute()` sends them again: call `execute()` to start one at once.
- A task is not a `Promise` instance, although its type is assignable to `Promise`: `instanceof Promise` is false, and Bun's `expect(…).rejects` needs the real promise that `execute()` returns.
