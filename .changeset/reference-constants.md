---
"igdb-kit": minor
---

Add named ids for reference tables (`GameType`, `Platform`, `Theme`, `ExternalGameSource`, `PopularityType`, `ReleaseDateRegion`…), generated from the API.

Fields IGDB replaced (`games.category`, `release_dates.region`, `external_games.category`…) are removed from the types and rejected with the name of their replacement: IGDB accepts them but leaves them empty or no longer updates them, so a filter on one silently matched nothing or too little. The legacy enums only those fields used (`GameCategoryEnum`…) are removed too.
