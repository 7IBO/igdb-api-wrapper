---
"igdb-kit": minor
---

Queries in the user's language:

- `g.supportsLanguage(language, kind?)`, a named filter on `games`: `supportsLanguage("fr-FR", "audio")` keeps the games with a French voice-over. It takes `Language` ids or a locale, whose IGDB languages it uses (`"en-GB"`: English (UK) or English), and one kind of support matched on the same `language_supports` row.
- `searchAll()` finds games by their alternative and localized titles, which IGDB's search index misses: "Wiedźmin 3", "ウィッチャー", "Pokémon Épée", "Layton und das geheimnisvolle Dorf" (56 of 67 localized titles found, against 26). They rank after every name match, with `matched: "alternative_name"` and the title in `alternative_name`. The new `alternativeTitles` option (`"auto"` by default) sends one more request, a multiquery, alongside the search for a term in another script than Latin, or after it when fewer than `limit` hits match by name; `false` turns it off.
