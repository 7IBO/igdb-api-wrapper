---
"igdb-kit": minor
---

`igdb.games.match({ name, platforms, year })` finds the games a store or list title may be, for titles without a store id IGDB knows (PlayStation, Xbox): it looks in names, alternative names and localized titles, ignores trademark signs, punctuation, accents and case, reads "VII" as "7", also tries the title without its edition or platform label, and returns candidates best first, each with a score from 0 to 1 and the title that matched. `platforms` takes ids or names ("PS5").
