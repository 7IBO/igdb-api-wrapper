---
"igdb-kit": patch
---

`byGame()`, views and `searchAll()` no longer lose data when the same call runs twice at once. They modified the rows of the response, which the identical call in flight shares: the second call then found no links (`byGame()`, a view's `findById()`) or ranked games without their ratings (`searchAll()`).
