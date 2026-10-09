---
"igdb-kit": minor
---

Related games by query: `igdb.games.family(id)` reads a game's editions, children (DLCs, expansions, mods, episodes, seasons, packs, updates, remakes, ports...), the bundles that contain it, a bundle's contents and its series in one multiquery; `igdb.games.series(collectionId, { subseries, spinoffs })` lists a series in release order; `igdb.games.catalog(companyId, { roles, includeSubsidiaries })` lists a company's games with their roles. `findBy(field, ids)` groups rows by any relation on every endpoint (`igdb.games.findBy("version_parent", ids)`), and `linkedBy(field)` links a `games` query to a view by `version_parent`, `parent_game` or `bundles`.
