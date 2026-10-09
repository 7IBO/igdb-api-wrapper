---
"igdb-kit": minor
---

Names follow one set of conventions, now written down in the README's "Conventions" section. The old names keep working for one minor version and are marked deprecated:

- `findByGames()` replaces `byGame()`, next to `findById()`, `findByIds()` and `findByExternalIds()`.
- `searchAll({ includeEditions })` replaces `editions`.
- `popularitySnapshot({ limit })` replaces `top`, still counted per metric.
- `MAIN_GAME_TYPES` replaces `SEARCH_GAME_TYPES`, and fits a filter: `g.game_type.in(...MAIN_GAME_TYPES)`.

Options that filter on ids take one id as well as a list: `searchAll({ gameTypes })`, `popularitySnapshot({ types })` and `releaseDate({ statuses })`.
