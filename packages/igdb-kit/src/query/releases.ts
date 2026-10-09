import { QueryError } from "../core/errors";
import type { EndpointName } from "../generated/schema";
import { type DateInput, dateMillis } from "./dates";
import type { ExecuteOptions, Query } from "./query";

/** IGDB's maximum `limit`: rows are read this many at a time. */
const PAGE = 500;
const DAY_MS = 86_400_000;

/**
 * How precise a release date is, from its `date_format`. IGDB stores an imprecise date inside its
 * period: the 1st of the month for `month`, the last day of the quarter for `quarter`, and January 1st
 * or December 31st for `year`. Only `day` is an actual day; `tbd` has no date at all.
 */
export type ReleasePrecision = "day" | "month" | "quarter" | "year" | "tbd";

/** One row of `release_dates`, with its period worked out. */
export interface CalendarRelease {
  /** Id of the `release_dates` row. */
  id: number;
  precision: ReleasePrecision;
  /** First day of the period, at 00:00 UTC (the day itself for `day`). `null` when `tbd`. */
  start: Date | null;
  /** First day after the period, at 00:00 UTC (exclusive). `null` when `tbd`. */
  end: Date | null;
  /** IGDB's label for the date: `"Oct 20, 2026"`, `"Q4 2026"`, `"2027"`, `"TBD"`. */
  human: string | null;
  platform: number | null;
  /** `ReleaseDateRegion` id; `ReleaseDateRegion.Worldwide` (8) for three dates out of four. */
  region: number | null;
  /**
   * `ReleaseDateStatus` id (Full Release, Early Access, Advanced Access…). `null` when IGDB has none,
   * which is the case of most dates: the status is unknown, not "not released".
   */
  status: number | null;
}

/** One game of the calendar, with every release of it in the window. */
export interface ReleaseCalendarEntry<R> {
  game: R;
  /** The release that places the game in the calendar: the most precise one, then the earliest. */
  release: CalendarRelease;
  /** Every release of the game in the window (platforms, regions, statuses), earliest first. */
  releases: CalendarRelease[];
}

export interface ReleasesOptions extends ExecuteOptions {
  /**
   * Start of the window, inclusive: a `Date`, a `"YYYY-MM-DD"` string or Unix seconds. Release dates
   * are calendar days stored at 00:00 UTC, so the window is in UTC days: `from` is rounded down to its
   * UTC day.
   */
  from: DateInput;
  /** End of the window, exclusive, rounded up to a UTC day: `"2026-11-01"` ends with October 31st. */
  to: DateInput;
  /** Only releases on these platforms (`Platform` ids). */
  platforms?: readonly number[] | undefined;
  /** Only releases in these regions (`ReleaseDateRegion` ids), plus worldwide ones unless `includeWorldwide` is false. */
  regions?: readonly number[] | undefined;
  /** With `regions`, also count worldwide releases, which are releases in every region. Default true. */
  includeWorldwide?: boolean | undefined;
  /**
   * Only releases with these statuses (`ReleaseDateStatus` ids); `null` stands for "no status", which
   * most dates have. Default: every status except Offline and Cancelled, and no status.
   */
  statuses?: readonly (number | null)[] | undefined;
  /**
   * Which precisions to include. `tbd` releases have no date, so they are included whatever the
   * window. Default: every precision except `tbd`.
   */
  precision?: readonly ReleasePrecision[] | undefined;
  /**
   * When a `month`, `quarter` or `year` release is in the window: `"within"` when its whole period is
   * (`Oct 2026` and `Q4 2026` are in October to December, not in October alone), `"overlap"` when
   * its period overlaps the window (`2026` is then in every window of 2026). Default `"within"`.
   */
  match?: "within" | "overlap" | undefined;
  /** Throw instead of reading more than this many release dates. Default 10,000 (21 requests at most). */
  maxRows?: number | undefined;
}

/** @internal The fields of `release_dates` the calendar reads. */
export const RELEASE_FIELDS = [
  "date",
  "date_format",
  "human",
  "platform",
  "release_region",
  "status",
  "y",
  "m",
  "game",
] as const;

/** @internal */
export interface ReleaseRow {
  id: number;
  date?: number;
  date_format?: number;
  human?: string;
  platform?: number;
  release_region?: number;
  status?: number;
  y?: number;
  m?: number;
  game?: number;
}

/** `date_format` ids of each precision. */
const FORMATS: Record<ReleasePrecision, number[]> = {
  day: [0],
  month: [1],
  quarter: [3, 4, 5, 6],
  year: [2],
  tbd: [7],
};
const ORDER: Record<ReleasePrecision, number> = { day: 0, month: 1, quarter: 2, year: 3, tbd: 4 };
const DEFAULT_PRECISION: readonly ReleasePrecision[] = ["day", "month", "quarter", "year"];
/** Offline (4) and Cancelled (5) dates are not releases. */
const EXCLUDED_STATUSES = [4, 5];
const WORLDWIDE = 8;

/**
 * @internal The calendar of releases in a window: matching `release_dates` are counted and read in
 * parallel pages (1 + `ceil(rows / 500)` requests, batched), then their games are read with the
 * caller's fields and filter (`ceil(games / 500)` requests), and grouped one entry per game.
 */
export async function releaseCalendar<R>(
  /** `release_dates` with `RELEASE_FIELDS` selected and sorted by id. */
  releaseDates: Query<EndpointName, ReleaseRow>,
  /** The games these ids name that pass the caller's filter, with its selected fields. */
  findGames: (ids: number[], options: ExecuteOptions) => Promise<R[]>,
  options: ReleasesOptions,
): Promise<ReleaseCalendarEntry<R>[]> {
  const {
    from,
    to,
    platforms,
    regions,
    includeWorldwide = true,
    statuses,
    precision = DEFAULT_PRECISION,
    match = "within",
    maxRows = 10_000,
    ...execute
  } = options;
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new QueryError("maxRows must be a positive integer");
  const window = { from: utcDay(from, "from", Math.floor), to: utcDay(to, "to", Math.ceil) };
  if (window.to <= window.from) throw new QueryError("releases() needs `to` after `from`");
  const where = calendarWhere(window, {
    platforms,
    regions,
    includeWorldwide,
    statuses,
    precision,
    match,
  });
  const query = releaseDates.where(where);

  const [total, first] = await Promise.all([
    query.count().execute(execute),
    query.limit(PAGE).execute(execute),
  ]);
  if (total > maxRows) {
    throw new QueryError(
      `${total} release dates match, more than maxRows (${maxRows}): narrow the window or raise maxRows`,
    );
  }
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
      query
        .limit(PAGE)
        .offset((i + 1) * PAGE)
        .execute(execute),
    ),
  );

  const byGame = new Map<number, CalendarRelease[]>();
  const seen = new Set<number>();
  for (const row of [first, ...rest].flat()) {
    if (seen.has(row.id) || row.game === undefined) continue;
    seen.add(row.id);
    const release = toCalendarRelease(row);
    if (!precision.includes(release.precision) || !inWindow(release, window, match)) continue;
    const releases = byGame.get(row.game) ?? [];
    releases.push(release);
    byGame.set(row.game, releases);
  }
  const games = byGame.size > 0 ? await findGames([...byGame.keys()], execute) : [];
  const entries = games.map((game) => {
    const releases = (byGame.get((game as { id: number }).id) ?? []).sort(byDate);
    const release = [...releases].sort(
      (a, b) => ORDER[a.precision] - ORDER[b.precision] || byDate(a, b),
    )[0] as CalendarRelease;
    return { game, release, releases };
  });
  return entries.sort(
    (a, b) => byDate(a.release, b.release) || (a.game as { id: number }).id - (b.game as { id: number }).id,
  );
}

/** @internal The Apicalypse condition of a calendar: one branch per date range, TBD apart. */
export function calendarWhere(
  window: { from: number; to: number },
  options: Pick<
    ReleasesOptions,
    "platforms" | "regions" | "includeWorldwide" | "statuses" | "precision" | "match"
  >,
): string {
  const { precision = DEFAULT_PRECISION, includeWorldwide = true, match = "within" } = options;
  if (precision.length === 0) throw new QueryError("precision must name at least one precision");
  // An imprecise date lies inside its period: a period within the window has its date in it (the
  // exact test is done on the rows), and widening the window to whole periods finds every overlap.
  const inRange = `date >= ${seconds(window.from)} & date < ${seconds(window.to)}`;
  const lastDay = window.to - DAY_MS;
  const ranges = new Map<string, number[]>(); // date range -> date_format ids
  let tbd = false;
  for (const p of new Set(precision)) {
    const formats = FORMATS[p];
    if (formats === undefined) throw new QueryError(`Unknown precision "${p}"`);
    if (p === "tbd") tbd = true;
    else {
      const range =
        p === "day" || match === "within"
          ? inRange
          : `date >= ${seconds(periodStart(window.from, p))} & date < ${seconds(periodEnd(lastDay, p))}`;
      ranges.set(range, [...(ranges.get(range) ?? []), ...formats]);
    }
  }
  const branches = [...ranges].map(([range, formats]) => `date_format = ${list(formats)} & ${range}`);
  if (tbd) branches.push("date = null");
  const parts = [branches.length === 1 ? (branches[0] as string) : branches.map((b) => `(${b})`).join(" | ")];
  if (options.platforms !== undefined)
    parts.push(`platform = (${ids(options.platforms, "platforms").join(",")})`);
  if (options.regions !== undefined) {
    const list = new Set(ids(options.regions, "regions"));
    if (includeWorldwide) list.add(WORLDWIDE);
    parts.push(`release_region = (${[...list].join(",")})`);
  }
  if (options.statuses === undefined) {
    // `!=` keeps the dates without a status, unlike `=`.
    parts.push(`status != (${EXCLUDED_STATUSES.join(",")})`);
  } else {
    if (options.statuses.length === 0) throw new QueryError("statuses must not be empty");
    const known = options.statuses.filter((s): s is number => s !== null);
    const withNone = options.statuses.includes(null);
    const listed = known.length > 0 ? `status = (${ids(known, "statuses").join(",")})` : "";
    parts.push(withNone ? (listed ? `(${listed} | status = null)` : "status = null") : listed);
  }
  return parts.length === 1 ? (parts[0] as string) : parts.map((p) => `(${p})`).join(" & ");
}

/** @internal A `release_dates` row with its precision and period. */
export function toCalendarRelease(row: ReleaseRow): CalendarRelease {
  const base = {
    id: row.id,
    human: row.human ?? null,
    platform: row.platform ?? null,
    region: row.release_region ?? null,
    status: row.status ?? null,
  };
  if (row.date === undefined) return { ...base, precision: "tbd", start: null, end: null };
  const date = new Date(row.date * 1000);
  const year = row.y ?? date.getUTCFullYear();
  const format = row.date_format;
  let precision: ReleasePrecision;
  let start: number;
  let end: number;
  if (format === 0) {
    precision = "day";
    start = Math.floor(date.getTime() / DAY_MS) * DAY_MS;
    end = start + DAY_MS;
  } else if (format === 1) {
    const month = (row.m ?? date.getUTCMonth() + 1) - 1;
    precision = "month";
    start = Date.UTC(year, month, 1);
    end = Date.UTC(year, month + 1, 1);
  } else if (format !== undefined && format >= 3 && format <= 6) {
    const firstMonth = (format - 3) * 3;
    precision = "quarter";
    start = Date.UTC(year, firstMonth, 1);
    end = Date.UTC(year, firstMonth + 3, 1);
  } else {
    // 2 (YYYY), or a format IGDB may add: the year, the coarsest period that has a date.
    precision = "year";
    start = Date.UTC(year, 0, 1);
    end = Date.UTC(year + 1, 0, 1);
  }
  return { ...base, precision, start: new Date(start), end: new Date(end) };
}

function inWindow(
  release: CalendarRelease,
  window: { from: number; to: number },
  match: "within" | "overlap",
): boolean {
  if (release.start === null || release.end === null) return true;
  const start = release.start.getTime();
  const end = release.end.getTime();
  return match === "within"
    ? start >= window.from && end <= window.to
    : start < window.to && end > window.from;
}

/** Earliest first, the more precise first on the same start, TBD last. */
function byDate(a: CalendarRelease, b: CalendarRelease): number {
  const at = a.start?.getTime() ?? Number.POSITIVE_INFINITY;
  const bt = b.start?.getTime() ?? Number.POSITIVE_INFINITY;
  return (at === bt ? 0 : at < bt ? -1 : 1) || ORDER[a.precision] - ORDER[b.precision] || a.id - b.id;
}

function utcDay(value: DateInput, name: string, round: (x: number) => number): number {
  return round(dateMillis(value, `releases() ${name}`) / DAY_MS) * DAY_MS;
}

function periodStart(time: number, unit: "month" | "quarter" | "year"): number {
  const date = new Date(time);
  const month =
    unit === "year"
      ? 0
      : unit === "quarter"
        ? date.getUTCMonth() - (date.getUTCMonth() % 3)
        : date.getUTCMonth();
  return Date.UTC(date.getUTCFullYear(), month, 1);
}

function periodEnd(time: number, unit: "month" | "quarter" | "year"): number {
  const start = new Date(periodStart(time, unit));
  const months = unit === "year" ? 12 : unit === "quarter" ? 3 : 1;
  return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1);
}

/** `3` or `(3,4,5,6)`. */
function list(values: readonly number[]): string {
  return values.length === 1 ? String(values[0]) : `(${[...values].sort((a, b) => a - b).join(",")})`;
}

function seconds(time: number): number {
  return Math.floor(time / 1000);
}

function ids(values: readonly number[], name: string): number[] {
  if (values.length === 0) throw new QueryError(`${name} must not be empty`);
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) throw new QueryError(`Invalid id in ${name}: ${value}`);
  }
  return [...new Set(values)];
}
