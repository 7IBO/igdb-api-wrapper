---
"igdb-kit": minor
---

Locale helpers in `igdb-kit/game`:

- `resolveLocale(locale)` says what a locale picks in IGDB: its release region, its game localizations, its age rating organizations (USK then PEGI and ESRB in Germany, CERO then ESRB and PEGI in Japan…) and its IGDB languages, best first (`en-GB`: English (UK) then English). A locale without a country takes its likely one: `"fr"` is France, `"en"` the US, `"zh"` China.
- `parseAlternativeName(comment)` reads IGDB's 739 free-text comments of `alternative_names` ("Japanese title - romanization", "Brazilian title", "Korean Acroynm", "UK title", "Steam title") into a `kind`, a BCP 47 `language` and a `variant`. `alternativeTitles(game)` returns a game's alternative names read this way, without the executable file names.
- `localizedCover(game, locale)` returns the Japanese, Korean or European box art of a game's localizations, else its `cover`.

`localizedName()` finds more names and fewer wrong ones:

- It reads comments with `parseAlternativeName()`: Brazilian, Taiwanese, "Chinese Simplified" or "Korean title - translated" names are found, and a market's title is used in that market ("North American title" in the US and Canada, "UK title" in the UK).
- It checks the script of the name for Japanese, Chinese, Korean, Russian and the other languages not written in Latin letters: a romanization labeled "Japanese title" or pinyin labeled "Chinese title - simplified" no longer wins over the game's name. A name marked "original" is still trusted.
- Unofficial titles are skipped, and translations unless they are in the language's own script.
- The result has the `language` and `variant` of the name.

Behavior change: `releaseDate()` and `releasesByPlatform()` pick a region for a `locale` without a country, from its likely country (`"fr"`: Europe, `"ja"`: Japan), where they requested none before.
