import { DateFormat, ReleaseDateRegion } from "../generated/schema";
import { type ItemOf, idOf, type Ref, type Requires } from "./select";

/** Fields of `release_dates` that {@link releaseDate} reads. */
export type ReleaseDateFields =
  | "release_dates.date"
  | "release_dates.date_format"
  | "release_dates.release_region"
  | "release_dates.platform"
  | "release_dates.status";

interface ReleaseDateRow {
  date?: number | undefined;
  date_format?: Ref | undefined;
  human?: string | undefined;
  release_region?: Ref | undefined;
  platform?: Ref | undefined;
  status?: Ref | undefined;
}

/** A game whose selection lets {@link releaseDate} work. */
export interface ReleaseDatesInput {
  release_dates?: readonly ReleaseDateRow[] | undefined;
}

/** How precise a release date is, from its `date_format`. */
export type ReleasePrecision = "day" | "month" | "quarter" | "year" | "tbd";

/**
 * The status of a release date (`release_date_statuses`). `unknown` when IGDB has none, which is
 * the case for about half of all release dates (most of them full releases); `other` for a status
 * added to IGDB after this version.
 */
export type ReleaseStatus =
  | "alpha"
  | "beta"
  | "early_access"
  | "offline"
  | "cancelled"
  | "full_release"
  | "advanced_access"
  | "digital_compatibility"
  | "next_gen_patch"
  | "unknown"
  | "other";

const statuses: Record<number, ReleaseStatus> = {
  1: "alpha",
  2: "beta",
  3: "early_access",
  4: "offline",
  5: "cancelled",
  6: "full_release",
  34: "advanced_access",
  35: "digital_compatibility",
  36: "next_gen_patch",
};

// Which statuses make "the" release date of a game, best first. A missing status counts as a full
// release, as it does for IGDB's own `first_release_date`.
const statusRank: Record<ReleaseStatus, number> = {
  full_release: 0,
  unknown: 0,
  digital_compatibility: 1,
  next_gen_patch: 1,
  other: 1,
  advanced_access: 2,
  early_access: 2,
  beta: 3,
  alpha: 3,
  offline: 4,
  cancelled: 4,
};

/** How the release row was found for the requested region. */
export type ReleaseMatch =
  /** A row of the requested region. */
  | "exact"
  /** A worldwide row, which applies to every region. */
  | "worldwide"
  /** No row for the region nor worldwide: the earliest of another region. */
  | "other_region"
  /** No region was requested: the earliest of any region. */
  | "any_region";

export interface GameRelease<R = ReleaseDateRow> {
  /**
   * IGDB's timestamp as a `Date` (UTC midnight), undefined when TBD. Only exact with precision
   * `day`: IGDB stores the first day of the month for `month`, the last day of the quarter for
   * `quarter`, and December 31 (January 1 on some old rows) for `year`. Format from
   * `precision`, `year`, `quarter`, `month` and `day` instead.
   */
  date: Date | undefined;
  precision: ReleasePrecision;
  year: number | undefined;
  /** 1 to 4, for precision `quarter`. */
  quarter: number | undefined;
  /** 1 to 12, for precision `day` and `month`. */
  month: number | undefined;
  /** 1 to 31, for precision `day`. */
  day: number | undefined;
  /** IGDB's English text when selected: `Nov 19, 2026`, `Nov 2026`, `Q4 2026`, `2026`, `TBD`. */
  human: string | undefined;
  status: ReleaseStatus;
  /** The `release_date_statuses` id, undefined when the row has none. */
  statusId: number | undefined;
  /** `ReleaseDateRegion` id of the row. */
  region: number | undefined;
  /** `Platform` id of the row. */
  platform: number | undefined;
  match: ReleaseMatch;
  /** The `release_dates` row as selected. */
  row: R;
}

export interface ReleaseDateOptions {
  /** `ReleaseDateRegion` id. Rows of that region come first, then worldwide ones. */
  region?: number | undefined;
  /** `Platform` id. Only rows of that platform are considered. */
  platform?: number | undefined;
  /**
   * Statuses to consider. Default: all, ranked full release (or no status) first, then
   * compatibility releases, early and advanced access, beta and alpha, and offline or cancelled last.
   */
  statuses?: readonly ReleaseStatus[] | undefined;
  /** Use another region when neither the requested one nor worldwide has a row. Default true. */
  fallback?: boolean | undefined;
}

/**
 * The release date to show for a game, with its precision and status. Picks, among the game's
 * `release_dates` (optionally for one platform), rows of the requested region or worldwide, then
 * the best status (a full release over early access), then the requested region over worldwide,
 * then dated over TBD, then the earliest. Periods are compared by their last day, so a precise date
 * wins over the month or year that contains it ("Mar 04, 1991" over "1991"), where IGDB's
 * `first_release_date` takes the period's stored timestamp. Returns null when no row matches.
 *
 * ```ts
 * const game = await igdb.games.select("name", "release_dates.*").findByIdOrThrow(1942);
 * releaseDate(game, { region: ReleaseDateRegion.Europe, platform: Platform.NintendoSwitch });
 * // { date, precision: "day", year: 2021, month: 1, day: 28, status: "full_release", match: "worldwide", ... }
 * ```
 */
export function releaseDate<G extends object>(
  game: G & Requires<G, ReleaseDateFields>,
  options: ReleaseDateOptions = {},
): GameRelease<ItemOf<G, "release_dates">> | null {
  const rows: readonly ReleaseDateRow[] = (game as ReleaseDatesInput).release_dates ?? [];
  return pick(rows, options) as GameRelease<ItemOf<G, "release_dates">> | null;
}

/**
 * One release per platform, chosen as {@link releaseDate} does, sorted by date (TBD last). For a
 * "Released on" list: `PC: May 19, 2015 · Switch: Jan 28, 2021`.
 */
export function releasesByPlatform<G extends object>(
  game: G & Requires<G, ReleaseDateFields>,
  options: Omit<ReleaseDateOptions, "platform"> = {},
): GameRelease<ItemOf<G, "release_dates">>[] {
  const rows: readonly ReleaseDateRow[] = (game as ReleaseDatesInput).release_dates ?? [];
  const platforms = new Set<number>();
  for (const row of rows) {
    const platform = idOf(row.platform);
    if (platform !== undefined) platforms.add(platform);
  }
  const releases: GameRelease[] = [];
  for (const platform of platforms) {
    const release = pick(rows, { ...options, platform });
    if (release) releases.push(release);
  }
  releases.sort(
    (a, b) => endOf(a.row) - endOf(b.row) || precisionOrder[a.precision] - precisionOrder[b.precision],
  );
  return releases as GameRelease<ItemOf<G, "release_dates">>[];
}

function pick(rows: readonly ReleaseDateRow[], options: ReleaseDateOptions): GameRelease | null {
  const ranked = rows
    .filter((row) => options.platform === undefined || idOf(row.platform) === options.platform)
    .filter((row) => !options.statuses || options.statuses.includes(statusOf(row)))
    .map((row) => rank(row, options.region))
    .filter((r) => r.applies || (options.region !== undefined && options.fallback !== false));
  const best = ranked.sort(compare)[0];
  if (!best) return null;
  let match: ReleaseMatch = "any_region";
  if (options.region !== undefined)
    match = best.exact ? "exact" : best.applies ? "worldwide" : "other_region";
  return toRelease(best.row, match);
}

interface Ranked {
  row: ReleaseDateRow;
  applies: boolean;
  exact: boolean;
  status: number;
  end: number;
  precision: number;
}

function rank(row: ReleaseDateRow, region: number | undefined): Ranked {
  const rowRegion = idOf(row.release_region);
  const exact = region !== undefined && rowRegion === region;
  return {
    row,
    exact,
    applies: region === undefined || exact || rowRegion === ReleaseDateRegion.Worldwide,
    status: statusRank[statusOf(row)],
    end: endOf(row),
    precision: precisionOrder[precisionOf(row)],
  };
}

function compare(a: Ranked, b: Ranked): number {
  return (
    Number(b.applies) - Number(a.applies) ||
    a.status - b.status ||
    Number(b.exact) - Number(a.exact) ||
    a.end - b.end ||
    a.precision - b.precision
  );
}

const precisionOrder: Record<ReleasePrecision, number> = { day: 0, month: 1, quarter: 2, year: 3, tbd: 4 };

function statusOf(row: ReleaseDateRow): ReleaseStatus {
  const id = idOf(row.status);
  return id === undefined ? "unknown" : (statuses[id] ?? "other");
}

function precisionOf(row: ReleaseDateRow): ReleasePrecision {
  const format = idOf(row.date_format);
  if (row.date === undefined || format === DateFormat.TBD) return "tbd";
  if (format === DateFormat.YYYYMMDD || format === undefined) return "day";
  if (format === DateFormat.YYYYMM) return "month";
  if (format >= DateFormat.YYYYQ1 && format <= DateFormat.YYYYQ4) return "quarter";
  return "year";
}

/** Last instant the release can fall on, so that "2027" sorts after "Q2 2027". TBD sorts last. */
function endOf(row: ReleaseDateRow): number {
  if (row.date === undefined) return Number.POSITIVE_INFINITY;
  const date = new Date(row.date * 1000);
  const year = date.getUTCFullYear();
  switch (precisionOf(row)) {
    case "month":
      return Date.UTC(year, date.getUTCMonth() + 1, 0);
    case "quarter":
      return Date.UTC(year, quarterOf(row) * 3, 0);
    case "year":
      return Date.UTC(year, 11, 31);
    default:
      return date.getTime();
  }
}

function quarterOf(row: ReleaseDateRow): number {
  return (idOf(row.date_format) ?? DateFormat.YYYYQ1) - DateFormat.YYYYQ1 + 1;
}

function toRelease<R extends ReleaseDateRow>(row: R, match: ReleaseMatch): GameRelease<R> {
  const precision = precisionOf(row);
  const date = row.date === undefined ? undefined : new Date(row.date * 1000);
  const statusId = idOf(row.status);
  return {
    date,
    precision,
    year: date && precision !== "tbd" ? date.getUTCFullYear() : undefined,
    quarter: precision === "quarter" ? quarterOf(row) : undefined,
    month: date && (precision === "day" || precision === "month") ? date.getUTCMonth() + 1 : undefined,
    day: date && precision === "day" ? date.getUTCDate() : undefined,
    human: row.human,
    status: statusOf(row),
    statusId,
    region: idOf(row.release_region),
    platform: idOf(row.platform),
    match,
    row,
  };
}
