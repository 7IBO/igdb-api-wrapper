---
"igdb-kit": patch
---

`memoryCache()`, the default cache, keeps 50 MB of responses at most (`maxBytes`), the least recently used going first, and does not keep a response above a quarter of it. It only counted responses (1,000), so caching every query (`cacheTtlMs`) while reading pages of several MB could hold gigabytes.
