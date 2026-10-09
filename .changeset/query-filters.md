---
"igdb-kit": minor
---

New filters: `named()` on any relation to a table with names (`g.platforms.named("PS5", "Switch")`, `g.genres.named("RPG")`, `g.franchises.named("The Witcher")`), looked up before the query is sent and replaced by ids; `g.mainGames()`, full games as a catalog lists them, with `includeUndated`, `includeAdult`, `includeEditions` and `requireCover`; `g.playableTogether({ platform, players, mode, coop })` on one `multiplayer_modes` row; and `eq(text, { caseSensitive: false })`.
