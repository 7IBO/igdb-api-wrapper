---
"igdb-kit": minor
---

Automatic multiquery batching: concurrent queries are grouped into multiqueries sized by estimated response size, invalid or oversized blocks are isolated by splitting, identical queries in flight are deduplicated, and `batch()` runs typed queries together.
