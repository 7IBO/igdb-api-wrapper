---
"igdb-kit": minor
---

Adds `weightedPopular()`, which ranks games by several PopScore metrics at once, each scaled to its top value, with `null` for a game the metric does not track; `igdb.popularitySnapshot()`, which returns ranked popularity rows to store, since IGDB keeps no history; and `releases()`, a release calendar with one entry per game, each date labeled by its precision (day, month, quarter, year or TBD), statuses and regions handled, and windows in UTC days. Also adds the `ReleaseDateStatus` constants.
