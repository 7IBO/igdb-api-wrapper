---
"igdb-kit": minor
---

Each endpoint only has the methods that work on it. `igdb.games` is a `GamesQuery`, with `popular()`, `weightedPopular()`, `releases()` and `findByExternalIds()`; the 24 endpoints whose rows point to games are `GameLinkedQuery`s, with `findByGames()`; the others are plain `Query`s. Autocompletion no longer offers `igdb.platforms.popular()`, which only threw. `QueryOf<N>` names the query type of an endpoint, and `select()`, `where()` and the other builder methods keep it.

Queries behave like promises: `catch()` and `finally()` run them, as `then()` does.

Views gain `count()` and `withCount()`. Their `findById()`, `findByIds()` and `first()` send nothing before they are awaited: they return a `Task`, whose `execute()` takes the request options (`signal`, `priority`). Passing the options as their last argument still works and is deprecated.

Breaking changes:

- The methods of games and of the endpoints that point to games are gone from the other endpoints, in the types and at runtime; calling them there only threw. Code that types a query as `Query<"games">` and calls `popular()` on it should use `GamesQuery` or `QueryOf<"games">`.
- A view's `findById()`, `findByIds()` and `first()` start their requests when awaited, not when called.
