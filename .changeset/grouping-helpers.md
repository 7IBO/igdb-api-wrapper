---
"igdb-kit": minor
---

New helpers in `igdb-kit/game` to group and link what a game's fields hold, with no request: `relatedGames()` and `relatedGameFields()` (parent, DLCs, expansions, remakes, remasters, ports, forks, bundles), `groupByParent()` (editions and ports under their original, with the missing parents to load), `franchisesOf()`, `externalIds()` and `externalId()` (store and service ids, several per source), `websiteLinks()` (by kind), `videoLinks()` (YouTube links, embed and thumbnail, with the kind of video), `bestImage()` (cover, artwork or screenshot, with its size) and `platformVersions()` (a console's versions with their regional dates). `imageSrcSet()` in `igdb-kit` gives a 1x and 2x `srcset`.
