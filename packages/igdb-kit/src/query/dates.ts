import { QueryError } from "../core/errors";

/**
 * A date as igdb-kit takes it everywhere: a `Date`, a `"YYYY-MM-DD"` or ISO string, or a number of
 * Unix seconds, the unit of IGDB's timestamps. A number above 10¹¹ is in milliseconds (`Date.now()`)
 * and throws a `QueryError`: pass a `Date` instead.
 */
export type DateInput = Date | string | number;

/** 10¹¹ seconds is the year 5138, and 10¹¹ milliseconds March 1973: a larger number is milliseconds. */
const MAX_SECONDS = 1e11;

/** @internal Milliseconds since 1970 of a date; `name` says where it was passed, in errors. */
export function dateMillis(input: DateInput, name: string): number {
  if (input instanceof Date) {
    const time = input.getTime();
    if (Number.isNaN(time)) throw new QueryError(`Invalid Date in ${name}`);
    return time;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new QueryError(`Invalid ${name}: ${input}`);
    if (Math.abs(input) >= MAX_SECONDS) {
      throw new QueryError(
        `${name} is ${input}, which looks like milliseconds: IGDB counts Unix seconds, so pass seconds or a Date`,
      );
    }
    return input * 1000;
  }
  const time = typeof input === "string" ? new Date(input).getTime() : Number.NaN;
  if (Number.isNaN(time)) {
    throw new QueryError(
      `Invalid ${name}: ${JSON.stringify(input)}. Pass a Date, a "YYYY-MM-DD" string or Unix seconds`,
    );
  }
  return time;
}

/** @internal Unix seconds of a date, rounded down; `name` says where it was passed, in errors. */
export function dateSeconds(input: DateInput, name: string): number {
  return Math.floor(dateMillis(input, name) / 1000);
}

/**
 * Unix seconds, the unit of IGDB's timestamps, of a `Date`, a `"YYYY-MM-DD"` or ISO string, or a
 * number of seconds: `toUnix(new Date())`, `toUnix("2026-01-01")`. Rounds down.
 */
export function toUnix(date: DateInput): number {
  return dateSeconds(date, "date");
}

/** A `Date` from an IGDB timestamp (Unix seconds), such as `first_release_date`. */
export function toDate(seconds: number): Date {
  return new Date(seconds * 1000);
}
