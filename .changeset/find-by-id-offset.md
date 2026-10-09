---
"igdb-kit": patch
---

`findById()`, `findByIdOrThrow()` and `findByIds()` ignore the query's `offset` and `sort`: `igdb.games.offset(10).findById(1942)` returned null. `expand()`, which looks entities up with `findByIds()`, gets the fix too.
