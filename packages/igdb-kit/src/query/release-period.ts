import { DateFormat } from "../generated/schema";

/**
 * How precise a release date is, from its `date_format`. IGDB stores an imprecise date inside its
 * period: the 1st of the month for `month`, the last day of the quarter for `quarter`, and December
 * 31st (January 1st on some old rows) for `year`. Only `day` is an actual day; `tbd` has no date.
 */
export type ReleasePrecision = "day" | "month" | "quarter" | "year" | "tbd";

/**
 * A release date with its period worked out, as `releases()` and `releaseDate()` both return it.
 * Every field is there, `null` when it does not apply.
 */
export interface ReleaseDetails {
  precision: ReleasePrecision;
  /** First day of the period, at 00:00 UTC (the day itself for `day`). `null` when `tbd`. */
  start: Date | null;
  /** First day after the period, at 00:00 UTC (exclusive). `null` when `tbd`. */
  end: Date | null;
  /** `null` when `tbd`. */
  year: number | null;
  /** 1 to 4, for precision `quarter`. */
  quarter: number | null;
  /** 1 to 12, for precision `day` and `month`. */
  month: number | null;
  /** 1 to 31, for precision `day`. */
  day: number | null;
  /** IGDB's English label, when selected: `"Oct 20, 2026"`, `"Oct 2026"`, `"Q4 2026"`, `"2026"`, `"TBD"`. */
  human: string | null;
  /** `Platform` id. */
  platform: number | null;
  /** `ReleaseDateRegion` id; `ReleaseDateRegion.Worldwide` (8) for three dates out of four. */
  region: number | null;
  /**
   * `ReleaseDateStatus` id (Full Release, Early Access, Advanced Access…). `null` when IGDB has none,
   * which is the case of most dates: the status is unknown, not "not released".
   */
  status: number | null;
}

type Ref = number | { id: number };

/** @internal The fields of a `release_dates` row that {@link releaseDetails} reads, as ids or expanded. */
export interface ReleaseDateLike {
  date?: number | undefined;
  date_format?: Ref | undefined;
  human?: string | undefined;
  platform?: Ref | undefined;
  release_region?: Ref | undefined;
  status?: Ref | undefined;
  y?: number | undefined;
  m?: number | undefined;
}

const DAY_MS = 86_400_000;

/** @internal The precision and period of a `release_dates` row, with its platform, region and status. */
export function releaseDetails(row: ReleaseDateLike): ReleaseDetails {
  const base = {
    human: row.human ?? null,
    platform: refId(row.platform),
    region: refId(row.release_region),
    status: refId(row.status),
  };
  const precision = releasePrecision(row);
  if (precision === "tbd" || row.date === undefined) {
    return {
      precision: "tbd",
      start: null,
      end: null,
      year: null,
      quarter: null,
      month: null,
      day: null,
      ...base,
    };
  }
  const date = new Date(row.date * 1000);
  if (precision === "day") {
    const start = new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
    return {
      precision,
      start,
      end: new Date(start.getTime() + DAY_MS),
      year: start.getUTCFullYear(),
      quarter: null,
      month: start.getUTCMonth() + 1,
      day: start.getUTCDate(),
      ...base,
    };
  }
  const year = row.y ?? date.getUTCFullYear();
  if (precision === "month") {
    const month = row.m ?? date.getUTCMonth() + 1;
    return {
      precision,
      start: new Date(Date.UTC(year, month - 1, 1)),
      end: new Date(Date.UTC(year, month, 1)),
      year,
      quarter: null,
      month,
      day: null,
      ...base,
    };
  }
  if (precision === "quarter") {
    const quarter = (refId(row.date_format) ?? DateFormat.YYYYQ1) - DateFormat.YYYYQ1 + 1;
    return {
      precision,
      start: new Date(Date.UTC(year, (quarter - 1) * 3, 1)),
      end: new Date(Date.UTC(year, quarter * 3, 1)),
      year,
      quarter,
      month: null,
      day: null,
      ...base,
    };
  }
  return {
    precision,
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
    year,
    quarter: null,
    month: null,
    day: null,
    ...base,
  };
}

/**
 * @internal The precision of a row: `tbd` without a date, `day` for `YYYYMMDD` (or no format), and
 * `year` for `YYYY` or a format IGDB may add, the coarsest period that has a date.
 */
export function releasePrecision(row: ReleaseDateLike): ReleasePrecision {
  const format = refId(row.date_format);
  if (row.date === undefined || format === DateFormat.TBD) return "tbd";
  if (format === null || format === DateFormat.YYYYMMDD) return "day";
  if (format === DateFormat.YYYYMM) return "month";
  if (format >= DateFormat.YYYYQ1 && format <= DateFormat.YYYYQ4) return "quarter";
  return "year";
}

function refId(ref: Ref | undefined): number | null {
  if (ref === undefined || ref === null) return null;
  return typeof ref === "object" ? ref.id : ref;
}
