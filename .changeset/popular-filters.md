---
"igdb-kit": patch
---

`popular()` and `weightedPopular()` give the exact ranking when a `where` matches few games. They read popularity rows in value order until enough games passed the filter, and gave up after `maxRows` with a partial list when those games are rarely popular: the 20 most visited games released only on Switch 2 came back as 14 games after 20 requests. The games a `where` matches are now counted along with the first page (the first round for `weightedPopular()`); when it falls short and they are at most 10,000, their own rows are read instead, which gives all 20 in 4 requests. Equal values are ranked by id, and `weightedPopular()` reads the top value of negatively weighted types with its first round instead of before it.
