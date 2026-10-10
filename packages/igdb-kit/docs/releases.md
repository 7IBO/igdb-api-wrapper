# Release calendar

`releases()` lists the games released in a window, one entry per game however many platforms, regions and statuses it has there:

```ts
import { GameType, Platform, ReleaseDateRegion, ReleaseDateStatus } from "igdb-kit";

const october = await igdb.games
  .select("name", "cover.image_id")
  .where((g) => g.game_type.eq(GameType.MainGame))
  .releases({
    from: "2026-10-01",
    to: "2026-11-01",                          // exclusive
    platforms: [Platform.PlayStation5, Platform.PCMicrosoftWindows],
    regions: [ReleaseDateRegion.Europe],       // worldwide releases count too
  });
// { game, release, releases }[], by date
// release: { precision: "day", start: Date, end: Date, year: 2026, month: 10, day: 20, human: "Oct 20, 2026", platform, region, status }
```

`release` is the game's most precise release in the window, then the earliest; `releases` lists them all. To show a date in the user's language, pass it to [`formatReleaseDate()`](display.md#release-dates).

## Precision

IGDB dates are not all days: `precision` is `"day"`, `"month"` (`Oct 2026`), `"quarter"` (`Q4 2026`), `"year"` or `"tbd"`, `start` and `end` bound the period, and `year`, `quarter`, `month` and `day` are set as far as the precision goes (`null` beyond). `releaseDate()` in `igdb-kit/game` returns the same fields.

A month, quarter or year is in the window when its whole period is, so `Q4 2026` is in October to December but not in October alone; `match: "overlap"` includes every period that overlaps the window. TBD dates are left out unless `precision` includes `"tbd"`, whatever the window.

## Window and statuses

Release dates are calendar days at 00:00 UTC, so the window is in UTC days: pass `"YYYY-MM-DD"` strings rather than local midnights. The query's `limit` and `offset`, when set, page the entries.

By default Offline and Cancelled dates are left out, and dates without a status, more than half of them, are kept. `statuses: [ReleaseDateStatus.FullRelease, null]` picks statuses, `null` standing for "no status".

## Cost

A window costs one count, `ceil(dates / 500)` pages read in parallel and `ceil(games / 500)` for the games, packed into multiqueries: a month of upcoming releases (1,700 dates, 1,000 games) takes 3 HTTP requests. Above `maxRows` dates (10,000 by default), it throws instead: page through long periods month by month.
