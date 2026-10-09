---
"igdb-kit": minor
---

`developedBy()` and `publishedBy()` also take company names, matched in full and ignoring case: `g.developedBy("CD Projekt RED")`. The names are looked up in `companies` first (cached for a day) and the query filters on their ids, which IGDB answers in well under a second instead of 10 to 25. A name that matches no company throws a `NotFoundError` with the companies that contain it in `suggestions`.
