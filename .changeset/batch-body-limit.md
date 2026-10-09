---
"igdb-kit": patch
---

Automatic batching keeps each multiquery body under IGDB's 32,000-byte limit. A batch of long queries, such as `findByIds()` of 6,000 ids, was sent whole, refused with a 413 and only then split, which cost a request. Through `proxyUrl`, bodies stay under 16 KB, the default `maxBodyBytes` of `igdbProxy`; the new `maxBodyBytes` client option sets another limit.
