---
"igdb-kit": patch
---

`findByIds()`, `iterate()`, `sync()` and `byGame()` size their pages by weight, near `maxBatchBytes` (4 MB): 500 rows of a light selection, fewer of a heavy one. 500 popular games with their media, companies and release dates expanded made pages of 8.8 to 9.7 MB, next to IGDB's 10 MB cap; they are now read in pages of about 4 MB. A page IGDB still refuses, with a 413 above 10 MB or a 504 when it gives up building it after 29 seconds, is read again in halves instead of failing. Response sizes are measured in bytes rather than characters, and `iterate()` throws a `QueryError` for a `pageSize` outside 1 to 500.
