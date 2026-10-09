import { type GameRelease, type ReleaseDateOptions, regionalReleases, releaseDate } from "./release";
import type { ItemOf } from "./select";

type DateField = "date" | "date_format" | "release_region";

/** Fields of `platforms` that {@link platformVersions} reads. */
export type PlatformVersionFields = `versions.platform_version_release_dates.${DateField}`;

type DateRowOf<P> = ItemOf<ItemOf<P, "versions">, "platform_version_release_dates">;
type MissingDateFields<P> = [DateRowOf<P>] extends [never]
  ? DateField
  : Exclude<DateField, keyof DateRowOf<P>>;

/**
 * `Requires<P, PlatformVersionFields>`, written out: TypeScript stops comparing selected types
 * three levels deep and would let a missing field through.
 */
export type PlatformVersionsRequires<P> = [MissingDateFields<P>] extends [never]
  ? unknown
  : { versions: `select("versions.platform_version_release_dates.${MissingDateFields<P>}") is missing` };

/** A platform whose selection lets {@link platformVersions} work. */
export interface PlatformVersionsInput {
  versions?: readonly { platform_version_release_dates?: readonly object[] | undefined }[] | undefined;
}

export interface PlatformVersionReleases<V, R> {
  /** The `platform_versions` row as selected. */
  version: V;
  /** The release date for the user's region, chosen as `releaseDate()` does; null when there is none. */
  release: GameRelease<R> | null;
  /** One release per region, earliest first: the Switch came out in China in 2019, in Brazil in 2020. */
  releases: GameRelease<R>[];
}

export type PlatformVersionsOptions = Pick<ReleaseDateOptions, "region" | "locale">;

type VersionOf<P> = ItemOf<P, "versions">;

/**
 * The versions of a platform (PlayStation 4, Slim, Pro; Switch, Lite, OLED) with their release
 * dates, earliest first, undated last. `locale` or `region` picks the date to show, as
 * `releaseDate()` does for a game. 311 of IGDB's 423 versions have a date.
 *
 * ```ts
 * const nintendoSwitch = await igdb.platforms.select("name", "versions.name",
 *   "versions.platform_version_release_dates.date", "versions.platform_version_release_dates.date_format",
 *   "versions.platform_version_release_dates.release_region").findByIdOrThrow(Platform.NintendoSwitch);
 * platformVersions(nintendoSwitch, { locale: "fr-FR" }).map((v) => [v.version.name, v.release?.year]);
 * // [["Initial version", 2017], ["Switch Lite", 2019], ["OLED Model", 2021]]
 * ```
 */
export function platformVersions<P extends object>(
  platform: P & PlatformVersionsRequires<P>,
  options: PlatformVersionsOptions = {},
): PlatformVersionReleases<VersionOf<P>, ItemOf<VersionOf<P>, "platform_version_release_dates">>[] {
  const versions = (platform as PlatformVersionsInput).versions ?? [];
  const entries = versions.map((version) => {
    const dates = { release_dates: version.platform_version_release_dates ?? [] } as never;
    return { version, release: releaseDate(dates, options), releases: regionalReleases(dates) };
  });
  const start = (entry: (typeof entries)[number]) =>
    entry.release?.start?.getTime() ?? Number.POSITIVE_INFINITY;
  return entries.sort((a, b) => start(a) - start(b)) as never;
}
