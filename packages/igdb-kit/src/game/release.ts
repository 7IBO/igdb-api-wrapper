import { ReleaseDateRegion, ReleaseDateStatus } from "../generated/schema";
import { type ReleaseDetails, type ReleasePrecision, releaseDetails } from "../query/release-period";
import { resolveLocale } from "./locale";
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
  y?: number | undefined;
  m?: number | undefined;
}

/** A game whose selection lets {@link releaseDate} work. */
export interface ReleaseDatesInput {
  release_dates?: readonly ReleaseDateRow[] | undefined;
}

export type { ReleaseDetails, ReleasePrecision };

/**
 * @deprecated Statuses are `ReleaseDateStatus` ids now, as everywhere in igdb-kit: `status` is the id
 * (`null` when IGDB has none), and `statuses` takes ids. The names stay accepted in `statuses` for
 * one version.
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

const statusNames: Record<number, ReleaseStatus> = {
  [ReleaseDateStatus.Alpha]: "alpha",
  [ReleaseDateStatus.Beta]: "beta",
  [ReleaseDateStatus.EarlyAccess]: "early_access",
  [ReleaseDateStatus.Offline]: "offline",
  [ReleaseDateStatus.Cancelled]: "cancelled",
  [ReleaseDateStatus.FullRelease]: "full_release",
  [ReleaseDateStatus.AdvancedAccess]: "advanced_access",
  [ReleaseDateStatus.DigitalCompatibilityRelease]: "digital_compatibility",
  [ReleaseDateStatus.NextGenOptimizationPatchRelease]: "next_gen_patch",
};

// Which statuses make "the" release date of a game, best first. A missing status counts as a full
// release, as it does for IGDB's own `first_release_date`; a status added to IGDB after this version
// ranks with the compatibility releases.
const statusRanks: Record<number, number> = {
  [ReleaseDateStatus.FullRelease]: 0,
  [ReleaseDateStatus.DigitalCompatibilityRelease]: 1,
  [ReleaseDateStatus.NextGenOptimizationPatchRelease]: 1,
  [ReleaseDateStatus.AdvancedAccess]: 2,
  [ReleaseDateStatus.EarlyAccess]: 2,
  [ReleaseDateStatus.Beta]: 3,
  [ReleaseDateStatus.Alpha]: 3,
  [ReleaseDateStatus.Offline]: 4,
  [ReleaseDateStatus.Cancelled]: 4,
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

/**
 * The release date to show, with its period worked out: the same fields as a `releases()` calendar
 * release, plus how it was found and the row itself.
 */
export interface GameRelease<R = ReleaseDateRow> extends ReleaseDetails {
  match: ReleaseMatch;
  /** The `release_dates` row as selected. */
  row: R;
  /**
   * @deprecated Use `start`, with `precision`. IGDB's timestamp as a `Date`, `null` when TBD: the
   * first day of the month for `month`, but the last day of the quarter for `quarter` and December 31
   * (January 1 on some old rows) for `year`.
   */
  date: Date | null;
  /** @deprecated Use `status`, which is the `ReleaseDateStatus` id now. */
  statusId: number | null;
}

export interface ReleaseDateOptions {
  /** `ReleaseDateRegion` id. Rows of that region come first, then worldwide ones. */
  region?: number | undefined;
  /**
   * The user's locale (`"fr-FR"`, `"en-US"`, `"ja-JP"`), when `region` is not given: its country picks
   * the region, as {@link resolveLocale} does. Europe for a European country, North America for the
   * US and Canada, Japan, Korea, China, Asia (Taiwan, Hong Kong, Southeast Asia), Australia, New
   * Zealand and Brazil. A locale without a country takes its likely one (`"fr"`: France). Another
   * country requests no region.
   */
  locale?: string | undefined;
  /** `Platform` id. Only rows of that platform are considered. */
  platform?: number | undefined;
  /**
   * Statuses to consider: `ReleaseDateStatus` ids, one or several, `null` standing for "no status".
   * Default: all, ranked full release (or no status) first, then compatibility releases, early and
   * advanced access, beta and alpha, and offline or cancelled last. The names of {@link ReleaseStatus}
   * are accepted for one more version.
   */
  statuses?: number | readonly (number | null | ReleaseStatus)[] | undefined;
  /** Use another region when neither the requested one nor worldwide has a row. Default true. */
  fallback?: boolean | undefined;
}

/**
 * The release date to show for a game, with its precision and status. Picks, among the game's
 * `release_dates` (optionally for one platform), rows of the requested region or worldwide, then
 * the best status (a full release over early access), then the requested region over worldwide,
 * then dated over TBD, then the earliest. Periods are compared by their end, so a precise date wins
 * over the month or year that contains it ("Mar 04, 1991" over "1991"), where IGDB's
 * `first_release_date` takes the period's stored timestamp. Returns null when no row matches.
 *
 * ```ts
 * const game = await igdb.games.select("name", "release_dates.*").findByIdOrThrow(1942);
 * releaseDate(game, { locale: "fr-FR", platform: Platform.NintendoSwitch });
 * // { precision: "day", start, year: 2021, month: 1, day: 28, status: 6, region: 8, match: "worldwide", ... }
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
  releases.sort((a, b) => endOf(a) - endOf(b) || precisionOrder[a.precision] - precisionOrder[b.precision]);
  return releases as GameRelease<ItemOf<G, "release_dates">>[];
}

function pick(rows: readonly ReleaseDateRow[], options: ReleaseDateOptions): GameRelease | null {
  const region =
    options.region ??
    (options.locale === undefined ? undefined : (resolveLocale(options.locale).releaseRegion ?? undefined));
  const statuses = typeof options.statuses === "number" ? [options.statuses] : options.statuses;
  const ranked = rows
    .filter((row) => options.platform === undefined || idOf(row.platform) === options.platform)
    .map((row) => rank(row, region))
    .filter((r) => !statuses || statuses.some((s) => statusIs(r.release.status, s)))
    .filter((r) => r.applies || (region !== undefined && options.fallback !== false));
  const best = ranked.sort(compare)[0];
  if (!best) return null;
  let match: ReleaseMatch = "any_region";
  if (region !== undefined) match = best.exact ? "exact" : best.applies ? "worldwide" : "other_region";
  const { row, release } = best;
  return {
    ...release,
    match,
    row,
    date: row.date === undefined ? null : new Date(row.date * 1000),
    statusId: release.status,
  };
}

interface Ranked {
  row: ReleaseDateRow;
  release: ReleaseDetails;
  applies: boolean;
  exact: boolean;
  status: number;
}

function rank(row: ReleaseDateRow, region: number | undefined): Ranked {
  const release = releaseDetails(row);
  const exact = region !== undefined && release.region === region;
  return {
    row,
    release,
    exact,
    applies: region === undefined || exact || release.region === ReleaseDateRegion.Worldwide,
    status: release.status === null ? 0 : (statusRanks[release.status] ?? 1),
  };
}

function compare(a: Ranked, b: Ranked): number {
  return (
    Number(b.applies) - Number(a.applies) ||
    a.status - b.status ||
    Number(b.exact) - Number(a.exact) ||
    endOf(a.release) - endOf(b.release) ||
    precisionOrder[a.release.precision] - precisionOrder[b.release.precision]
  );
}

const precisionOrder: Record<ReleasePrecision, number> = { day: 0, month: 1, quarter: 2, year: 3, tbd: 4 };

/** End of the period, so that "2027" sorts after "Q2 2027". TBD sorts last. */
function endOf(release: ReleaseDetails): number {
  return release.end?.getTime() ?? Number.POSITIVE_INFINITY;
}

/** Whether a status id (`null`: none) is the one an option names, as an id or by its old name. */
function statusIs(status: number | null, option: number | null | ReleaseStatus): boolean {
  if (typeof option !== "string") return status === option;
  if (status === null) return option === "unknown";
  return (statusNames[status] ?? "other") === option;
}
