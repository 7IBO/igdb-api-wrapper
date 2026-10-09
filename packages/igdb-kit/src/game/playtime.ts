import type { Requires } from "./select";

/** Fields of `game_time_to_beats` that {@link timeToBeat} reads. */
export type TimeToBeatFields = "hastily" | "normally" | "completely" | "count";

/** A `game_time_to_beats` row whose selection lets {@link timeToBeat} work. */
export interface TimeToBeatInput {
  hastily?: number | undefined;
  normally?: number | undefined;
  completely?: number | undefined;
  count?: number | undefined;
}

/**
 * How a game is played to the end, as IGDB's `game_time_to_beats` names it: `hastily` (main
 * story), `normally` (story and some extras), `completely` (100%).
 */
export type PlaytimeKind = "hastily" | "normally" | "completely";

export interface Playtime {
  /** Average time in seconds. */
  seconds: number;
  kind: PlaytimeKind;
  /** Number of submissions behind the averages (1 for 72% of rows). */
  count: number | undefined;
}

/**
 * The playtime to show from a `game_time_to_beats` row: the first of `prefer` that IGDB has
 * (default `normally`, then `hastily`, then `completely`). Null without a row (97% of games have
 * none: fetch it with `game_time_to_beats where game_id = …`) or without any time in it.
 * The three averages come from different submissions, so `hastily` can exceed `normally`.
 *
 * ```ts
 * const row = await igdb.game_time_to_beats.select("hastily", "normally", "completely", "count")
 *   .where((t) => t.game_id.eq(1942)).first();
 * const time = timeToBeat(row); // { seconds: 254778, kind: "normally", count: 41 }
 * formatPlaytime(time?.seconds); // "71 hr"
 * ```
 */
export function timeToBeat<R extends object>(
  row: (R & Requires<R, TimeToBeatFields>) | null | undefined,
  prefer: readonly PlaytimeKind[] = ["normally", "hastily", "completely"],
): Playtime | null {
  if (!row) return null;
  const input = row as TimeToBeatInput;
  for (const kind of prefer) {
    const seconds = input[kind];
    if (typeof seconds === "number" && seconds > 0) return { seconds, kind, count: input.count };
  }
  return null;
}

export interface FormatPlaytimeOptions {
  /** BCP 47 locale for `Intl.NumberFormat`. Default: the runtime's. */
  locale?: string | readonly string[] | undefined;
  /** `short` (default): "71 hr"; `narrow`: "71h"; `long`: "71 hours". */
  unitDisplay?: "short" | "narrow" | "long" | undefined;
}

/**
 * A playtime in seconds as a localized duration: minutes under an hour ("45 min"), hours with
 * half-hour steps under ten hours ("2.5 hr"), whole hours above ("71 hr"). Undefined for a missing
 * or non-positive value.
 */
export function formatPlaytime(seconds: number, options?: FormatPlaytimeOptions): string;
export function formatPlaytime(
  seconds: number | undefined | null,
  options?: FormatPlaytimeOptions,
): string | undefined;
export function formatPlaytime(
  seconds: number | undefined | null,
  options: FormatPlaytimeOptions = {},
): string | undefined {
  if (typeof seconds !== "number" || !(seconds > 0)) return undefined;
  const locale = options.locale as string | string[] | undefined;
  const unitDisplay = options.unitDisplay ?? "short";
  const minutes = seconds / 60;
  if (minutes < 59.5) {
    return new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay }).format(
      Math.max(1, Math.round(minutes)),
    );
  }
  const hours = minutes / 60;
  const rounded = hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay,
    maximumFractionDigits: 1,
  }).format(rounded);
}
