---
"igdb-kit": minor
---

New `igdb-kit/game` subpath: pure helpers that turn a selected game into what a page shows, with no request. `releaseDate()` picks the date to show by region, platform and status with its precision (day, month, quarter, year, TBD); `companies()`, `storeLinks()`, `ageRating()`, `localizedName()`, `languages()`, `multiplayer()`, `parentGame()`, `timeToBeat()` and `formatPlaytime()` cover the other fields. Each helper requires the fields it reads at compile time and keeps unknown data apart from "no".
