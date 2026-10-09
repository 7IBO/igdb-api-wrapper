import { QueryError } from "../core/errors";
import { resolveLocale } from "../game/locale";
import {
  type EndpointName,
  type Endpoints,
  endpoints,
  entities,
  GameStatus,
  GameType,
  LanguageSupportType,
  ReleaseDateStatus,
  removedFields,
  Theme,
  timestampFields,
} from "../generated/schema";
import { type DateInput, dateSeconds } from "./dates";
import { type ReleaseFilter, releaseFilterParts } from "./releases";
import type { TimestampKeys } from "./types";

type Scalar = string | number | boolean;
type Value = Scalar | Date;

/**
 * The game types of full games: main games, their remakes, remasters, ports and expanded
 * re-releases, and expansions. `searchAll()` and `g.mainGames()` keep these by default, and `where`
 * takes them as `g.game_type.in(...MAIN_GAME_TYPES)`. Mods, forks, DLCs, bundles, episodes,
 * seasons, packs and updates outnumber main games in most searches (153 mods out of 381 game hits
 * for "zelda").
 */
export const MAIN_GAME_TYPES: readonly number[] = [
  GameType.MainGame,
  GameType.Expansion,
  GameType.StandaloneExpansion,
  GameType.Remake,
  GameType.Remaster,
  GameType.ExpandedGame,
  GameType.Port,
];

/**
 * @internal Names in a condition, which the client turns into ids before sending: IGDB answers
 * `involved_companies.company = (70)` in under a second, and the name filter it replaces in 10 to
 * 25 seconds.
 */
export interface NameLookup {
  /** The name filter as it appears in the condition text, replaced by `field = (ids)`. */
  readonly text: string;
  /** The relation the ids are matched on: `involved_companies.company`, `platforms`. */
  readonly field: string;
  /** The endpoint the names are looked up in: `companies`, `platforms`. */
  readonly endpoint: EndpointName;
  /** Names, each matched in full, ignoring case. */
  readonly names: readonly string[];
}

/** A compiled `where` condition. Combine with `.and()` / `.or()` or the {@link and} / {@link or} helpers. */
export class Condition {
  /** @internal */
  constructor(
    readonly text: string,
    private readonly composite = false,
    /** @internal Names the client resolves to ids before sending. */
    readonly lookups: readonly NameLookup[] = [],
  ) {}

  and(...others: Condition[]): Condition {
    return and(this, ...others);
  }

  or(...others: Condition[]): Condition {
    return or(this, ...others);
  }

  /** @internal Text safe to embed inside another `&` / `|` expression. */
  get operand(): string {
    return this.composite ? `(${this.text})` : this.text;
  }

  toString(): string {
    return this.text;
  }
}

function join(op: "&" | "|", conditions: Condition[]): Condition {
  if (conditions.length === 0) throw new QueryError("and()/or() need at least one condition");
  if (conditions.length === 1) return conditions[0] as Condition;
  return new Condition(
    conditions.map((c) => c.operand).join(` ${op} `),
    true,
    conditions.flatMap((c) => c.lookups),
  );
}

export const and = (...conditions: Condition[]): Condition => join("&", conditions);
export const or = (...conditions: Condition[]): Condition => join("|", conditions);

interface NullFilter {
  /** `field = null`: the field is absent. */
  isNull(): Condition;
  /** `field != null`: the field is present. */
  notNull(): Condition;
}

export interface NumberFilter<T extends number = number> extends NullFilter {
  eq(value: T): Condition;
  ne(value: T): Condition;
  gt(value: number): Condition;
  gte(value: number): Condition;
  lt(value: number): Condition;
  lte(value: number): Condition;
  /** `field = (a, b)`: equals any of the values. */
  in(...values: T[]): Condition;
  /** `field != (a, b)`: equals none of the values. */
  notIn(...values: T[]): Condition;
}

/**
 * Filters on a Unix-timestamp field. Values are {@link DateInput}s: a `Date` or a `"YYYY-MM-DD"` string
 * is converted to the seconds IGDB counts, so `gte(new Date())` never compares milliseconds to
 * seconds, and a number is taken as seconds (one in milliseconds throws).
 */
export interface TimestampFilter extends NullFilter {
  eq(value: DateInput): Condition;
  ne(value: DateInput): Condition;
  gt(value: DateInput): Condition;
  gte(value: DateInput): Condition;
  lt(value: DateInput): Condition;
  lte(value: DateInput): Condition;
  /** `field >= from & field < to`: on or after `from`, before `to`. */
  between(from: DateInput, to: DateInput): Condition;
  in(...values: DateInput[]): Condition;
  notIn(...values: DateInput[]): Condition;
}

export interface StringFilter extends NullFilter {
  /** `field = "value"`, or `field ~ "value"` (the whole value, ignoring case) with `caseSensitive: false`. */
  eq(value: string, options?: { caseSensitive?: boolean }): Condition;
  ne(value: string): Condition;
  in(...values: string[]): Condition;
  notIn(...values: string[]): Condition;
  /** `field ~ "value"*` (case-insensitive unless `caseSensitive`). */
  startsWith(value: string, options?: { caseSensitive?: boolean }): Condition;
  /** `field ~ *"value"` (case-insensitive unless `caseSensitive`). */
  endsWith(value: string, options?: { caseSensitive?: boolean }): Condition;
  /** `field ~ *"value"*` (case-insensitive unless `caseSensitive`). */
  contains(value: string, options?: { caseSensitive?: boolean }): Condition;
}

export interface BooleanFilter extends NullFilter {
  eq(value: boolean): Condition;
  ne(value: boolean): Condition;
}

/** Filters on array fields. For relations the values are ids. */
export interface ArrayFilter<T extends Scalar> extends NullFilter {
  /** `field = (a, b)`: contains at least one of the values. */
  any(...values: T[]): Condition;
  /** `field = [a, b]`: contains all of the values. */
  all(...values: T[]): Condition;
  /** `field != (a, b)`: contains none of the values. */
  none(...values: T[]): Condition;
  /**
   * @deprecated IGDB has no "does not contain all" operator: its documented `= ![a, b]` is a syntax
   * error. Throws a `QueryError`. Use `none()` for "contains none of the values".
   */
  notAll(...values: T[]): Condition;
  /** `field = {a, b}`: contains exactly these values, ids included. */
  exactly(...values: T[]): Condition;
}

/** On a relation to an entity with a name: platforms, genres, themes, franchises, companies... */
export interface NamedFilter {
  /**
   * The relation points to one of the rows with these names, matched in full, ignoring case:
   * `g.platforms.named("PS5", "Nintendo Switch")`, `g.genres.named("Shooter")`,
   * `g.franchises.named("The Witcher")`. A platform also matches by its abbreviation or alternative
   * name. The client looks the names up before sending the query and filters on their ids: a
   * reference table (platforms, genres, themes, game modes...) is read whole and cached for a day,
   * any other is one cached request per name. A name that matches nothing throws a `NotFoundError`
   * listing close names.
   */
  named(...names: string[]): Condition;
}

type NamedOf<U> = "name" extends keyof U ? NamedFilter : unknown;

type FieldFilter<T> = [T] extends [readonly (infer U)[]]
  ? U extends Scalar
    ? ArrayFilter<U>
    : ArrayFilter<number> & WhereFields<U> & NamedOf<U>
  : [T] extends [string]
    ? StringFilter
    : [T] extends [number]
      ? NumberFilter<T>
      : [T] extends [boolean]
        ? BooleanFilter
        : NumberFilter & WhereFields<T> & NamedOf<T>;

/**
 * The argument of `where(e => ...)`. Each field exposes the filters valid for its type; a relation can
 * be filtered by id or by one of its own fields (`g.platforms.name.eq("PC")`). Filtering three levels
 * deep makes IGDB time out: resolve the id first instead.
 */
export type WhereFields<E> = {
  readonly [K in keyof E & string]-?: K extends TimestampKeys<E> ? TimestampFilter : FieldFilter<E[K]>;
};

/** @internal An Apicalypse literal: a quoted string, a number, `null`, or a `Date` in Unix seconds. */
export function literal(value: Value | null): string {
  if (value === null) return "null";
  if (value instanceof Date) return String(dateSeconds(value, "where"));
  if (typeof value === "string") return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new QueryError(`Invalid number in where: ${value}`);
  }
  return String(value);
}

const list = (values: Value[], open: string, close: string) => {
  if (values.length === 0) throw new QueryError("Expected at least one value");
  return `${open}${values.map(literal).join(",")}${close}`;
};

/** The filters of the field at `path`; on a timestamp field, values are dates (see TimestampFilter). */
function filterOps(path: string, timestamp = false): Record<string, (...args: never[]) => Condition> {
  const c = (rest: string) => new Condition(`${path} ${rest}`);
  const text = (value: string, before: string, after: string, options?: { caseSensitive?: boolean }) =>
    c(`${options?.caseSensitive ? "=" : "~"} ${before}${literal(value)}${after}`);
  const value = (v: Value): Value => (timestamp ? dateSeconds(v as DateInput, path) : v);
  const values = (v: Value[]) => v.map(value);
  return {
    isNull: () => c("= null"),
    notNull: () => c("!= null"),
    eq: (v: Value, o?: { caseSensitive?: boolean }) =>
      c(`${o?.caseSensitive === false && typeof v === "string" ? "~" : "="} ${literal(value(v))}`),
    ne: (v: Value) => c(`!= ${literal(value(v))}`),
    gt: (v: number | Date) => c(`> ${literal(value(v))}`),
    gte: (v: number | Date) => c(`>= ${literal(value(v))}`),
    lt: (v: number | Date) => c(`< ${literal(value(v))}`),
    lte: (v: number | Date) => c(`<= ${literal(value(v))}`),
    between: (from: Value, to: Value) =>
      new Condition(`${path} >= ${literal(value(from))} & ${path} < ${literal(value(to))}`, true),
    in: (...v: Value[]) => c(`= ${list(values(v), "(", ")")}`),
    notIn: (...v: Value[]) => c(`!= ${list(values(v), "(", ")")}`),
    any: (...v: Scalar[]) => c(`= ${list(v, "(", ")")}`),
    all: (...v: Scalar[]) => c(`= ${list(v, "[", "]")}`),
    none: (...v: Scalar[]) => c(`!= ${list(v, "(", ")")}`),
    notAll: (): Condition => {
      throw new QueryError(
        `IGDB has no "does not contain all" operator (its "= ![...]" is a syntax error): use none() for "contains none"`,
      );
    },
    exactly: (...v: Scalar[]) => c(`= ${list(v, "{", "}")}`),
    startsWith: (v: string, o?: { caseSensitive?: boolean }) => text(v, "", "*", o),
    endsWith: (v: string, o?: { caseSensitive?: boolean }) => text(v, "*", "", o),
    contains: (v: string, o?: { caseSensitive?: boolean }) => text(v, "*", "*", o),
  };
}

const OPS = new Set(Object.keys(filterOps("")));

/**
 * Options of {@link GameFilters.releasedIn}: a {@link ReleaseFilter}, whose options all apply to the
 * same release date.
 */
export interface ReleasedInOptions extends ReleaseFilter {
  /**
   * Released on or after this date: a `Date`, a `"YYYY-MM-DD"` string or Unix seconds. IGDB stores a
   * month-only date on its first day, a quarter on its last day and a year-only date on December 31;
   * TBD releases have no date and never match `from` or `to`.
   */
  from?: DateInput | undefined;
}

/**
 * Named filters on games, on the root of `where(g => ...)`. IGDB matches every condition on one array
 * of relations (`involved_companies`, `release_dates`) against the same entry, in the whole `where`:
 * `developedBy(908)` only matches games where company 908 is itself a developer. The flip side is that
 * two such filters joined with `and` must hold for one entry: `and(g.developedBy(908), g.publishedBy(50))`
 * matches no game unless one company entry is both, and
 * `and(g.releasedIn({ platforms: 48 }), g.releasedIn({ platforms: 6 }))` matches none. Run two queries
 * instead. `or` works as expected.
 */
export interface GameFilters {
  /**
   * Games one of these companies developed (`involved_companies` with `developer`). Pass company ids,
   * or company names matched in full, ignoring case: `developedBy("CD Projekt RED")`. A name matches
   * one company only: "Ubisoft" is not "Ubisoft Montreal". Ids and names can't be mixed in one call.
   *
   * Names are looked up in `companies` before the query is sent (one request, cached for a day), and
   * the query filters on their ids: IGDB takes 10 to 25 seconds on a company name filter. A name that
   * matches no company throws a `NotFoundError` listing close names.
   */
  developedBy(...companies: number[] | string[]): Condition;
  /** Games one of these companies published, regional publishers included. Takes ids or names. */
  publishedBy(...companies: number[] | string[]): Condition;
  /**
   * Games with a release date matching every option at once: `releasedIn({ platforms:
   * Platform.PlayStation5, regions: ReleaseDateRegion.Europe, from: "2026-01-01" })`. Unlike
   * `g.platforms.any()`, which lists every announced platform (cancelled ones included), it looks at
   * actual release dates and, unless `statuses` says otherwise, leaves out cancelled and offline ones.
   */
  releasedIn(options: ReleasedInOptions): Condition;
  /**
   * Games in a language: a `Language` id or several (`supportsLanguage(Language.French)`), or a
   * locale, which stands for its IGDB languages (`"fr-CA"`: French; `"en-GB"`: English (UK) or
   * English). With `kind`, only that kind of support: `supportsLanguage("fr", "audio")` keeps the
   * games with a French voice-over, 11,579 of the 61,635 in French. Like the other named filters it
   * holds for one `language_supports` row: `and(g.supportsLanguage("fr", "audio"),
   * g.supportsLanguage("fr", "subtitles"))` matches no game.
   */
  supportsLanguage(language: number | readonly number[] | string, kind?: LanguageSupportKind): Condition;
  /**
   * Full games, as a catalog lists them: the {@link MAIN_GAME_TYPES} (no DLCs, mods, bundles,
   * episodes, packs or updates), no editions (Gold, GOTY: `version_parent`), no Erotic theme, and
   * not offline, cancelled or rumored. 312,206 games, 82% of IGDB; 24% of them have no release date,
   * which `includeUndated: false` leaves out. `game_status` is empty on 92% of games, and those
   * stay, as do games without themes.
   */
  mainGames(options?: MainGamesOptions): Condition;
  /**
   * Games that several people can play together, from `multiplayer_modes`, where every condition
   * holds for one row: `playableTogether({ platforms: Platform.NintendoSwitch, players: 4, mode:
   * "local" })` is four players on one Switch, competitive or co-op. A row without a platform
   * applies to every platform. Only 5.7% of main games have multiplayer data, so a game left out is
   * not single-player for sure.
   */
  playableTogether(options?: PlayableTogetherOptions): Condition;
}

export interface MainGamesOptions {
  /** Keep games without a release date. Default true. */
  includeUndated?: boolean | undefined;
  /** Keep games with the Erotic theme (3% of games). Default false. */
  includeAdult?: boolean | undefined;
  /** Keep editions (`version_parent`): Gold, Deluxe, GOTY editions. Default false. */
  includeEditions?: boolean | undefined;
  /** Only games with a cover. Default false. */
  requireCover?: boolean | undefined;
}

export interface PlayableTogetherOptions {
  /** `Platform` id, or several: rows of these platforms, and rows that apply to every platform. */
  platforms?: number | readonly number[] | undefined;
  /** At least this many players. Default 2. */
  players?: number | undefined;
  /** `"local"`: on one machine (split screen, shared screen). `"online"`. Default either. */
  mode?: "local" | "online" | undefined;
  /** Co-op only, from IGDB's co-op flags and co-op player counts. Default false: co-op or competitive. */
  coop?: boolean | undefined;
}

/** A kind of language support: voice-over, subtitles or interface. */
export type LanguageSupportKind = "audio" | "subtitles" | "interface";

const supportTypes: Record<LanguageSupportKind, number> = {
  audio: LanguageSupportType.Audio,
  subtitles: LanguageSupportType.Subtitles,
  interface: LanguageSupportType.Interface,
};

/** The argument of `where(e => ...)` on an endpoint: its fields, plus {@link GameFilters} on `games`. */
export type WhereRoot<N extends EndpointName> = WhereFields<Endpoints[N]> &
  (N extends "games" ? GameFilters : unknown);

const ids = (values: readonly number[], what: string): string => {
  for (const id of values) {
    if (!Number.isSafeInteger(id) || id < 0) throw new QueryError(`Invalid ${what} id: ${id}`);
  }
  return list([...values], "(", ")");
};

function companyRole(role: "developer" | "publisher") {
  return (...companies: number[] | string[]) => {
    if (companies.length === 0) throw new QueryError(`${role}: pass at least one company`);
    let company: string;
    let lookups: NameLookup[] = [];
    if (companies.every((c) => typeof c === "number")) {
      company = `involved_companies.company = ${ids(companies, "company")}`;
    } else if (companies.every((c) => typeof c === "string")) {
      // `~` matches the whole name, ignoring case. The client sends `involved_companies.company =
      // (ids)` instead (see NameLookup); the name form stays in the text, which IGDB also accepts.
      // Both keep the role on one company entry, where `company = 908 | company.name ~ "..."` would
      // not: IGDB then matches the role on any entry.
      const names = companies.map((name) => `involved_companies.company.name ~ ${literal(name)}`);
      company = names.length === 1 ? names.join("") : `(${names.join(" | ")})`;
      lookups = [
        {
          text: company,
          field: "involved_companies.company",
          endpoint: "companies",
          names: companies as string[],
        },
      ];
    } else {
      throw new QueryError(`${role}: pass company ids or company names, not both`);
    }
    return new Condition(`${company} & involved_companies.${role} = true`, true, lookups);
  };
}

const gameFilters: Record<keyof GameFilters, (...args: never[]) => Condition> = {
  developedBy: companyRole("developer"),
  publishedBy: companyRole("publisher"),
  releasedIn: (options: ReleasedInOptions) => {
    const parts = releaseFilterParts(
      { platforms: options.platforms, regions: options.regions, includeWorldwide: options.includeWorldwide },
      "release_dates.",
    );
    if (options.from !== undefined)
      parts.push(`release_dates.date >= ${dateSeconds(options.from, "releasedIn() from")}`);
    if (options.to !== undefined)
      parts.push(`release_dates.date < ${dateSeconds(options.to, "releasedIn() to")}`);
    // `status != (4,5)` alone would drop release dates without a status, which IGDB treats as no match.
    const skipped = `${ReleaseDateStatus.Offline},${ReleaseDateStatus.Cancelled}`;
    parts.push(
      ...releaseFilterParts(
        { statuses: options.statuses },
        "release_dates.",
        `(release_dates.status = null | release_dates.status != (${skipped}))`,
      ),
    );
    if (parts.length === 0) parts.push("release_dates != null");
    return new Condition(parts.join(" & "), parts.length > 1);
  },
  mainGames: (options: MainGamesOptions = {}) => {
    const parts = [`game_type = ${ids(MAIN_GAME_TYPES, "game type")}`];
    if (!options.includeEditions) parts.push("version_parent = null");
    if (!options.includeAdult) parts.push(`themes != (${Theme.Erotic})`);
    // A top-level `!=` keeps the games without a status (92%): 312,206 games, measured.
    parts.push(`game_status != (${GameStatus.Offline},${GameStatus.Cancelled},${GameStatus.Rumored})`);
    if (options.includeUndated === false) parts.push("first_release_date != null");
    if (options.requireCover) parts.push("cover != null");
    return new Condition(parts.join(" & "), true);
  },
  playableTogether: (options: PlayableTogetherOptions = {}) => {
    const players = options.players ?? 2;
    if (!Number.isSafeInteger(players) || players < 1)
      throw new QueryError(`playableTogether(): players must be a positive integer, got ${players}`);
    if (options.mode !== undefined && options.mode !== "local" && options.mode !== "online")
      throw new QueryError(`playableTogether(): mode must be local or online, got ${options.mode}`);
    const m = "multiplayer_modes.";
    // IGDB stores 0 for an unknown count: a co-op flag alone stands for two players.
    const kinds = (where: "offline" | "online") => {
      const coop = [`${m}${where}coopmax >= ${players}`];
      if (players <= 2) coop.unshift(`${m}${where}coop = true`);
      return options.coop ? coop : [`${m}${where}max >= ${players}`, ...coop];
    };
    const any = [
      ...(options.mode !== "online" ? kinds("offline") : []),
      ...(options.mode !== "local" ? kinds("online") : []),
    ];
    const parts = [any.length === 1 ? (any[0] as string) : `(${any.join(" | ")})`];
    if (options.platforms !== undefined) {
      const platforms = typeof options.platforms === "number" ? [options.platforms] : options.platforms;
      parts.unshift(`(${m}platform = ${ids(platforms, "platform")} | ${m}platform = null)`);
    }
    return new Condition(parts.join(" & "), parts.length > 1);
  },
  supportsLanguage: (language: number | readonly number[] | string, kind?: LanguageSupportKind) => {
    const languages =
      typeof language === "string"
        ? resolveLocale(language).languages
        : typeof language === "number"
          ? [language]
          : language;
    if (languages.length === 0)
      throw new QueryError(
        typeof language === "string"
          ? `supportsLanguage(): IGDB has no language for the locale "${language}"`
          : "supportsLanguage(): pass at least one language",
      );
    const parts = [`language_supports.language = ${ids(languages, "language")}`];
    if (kind !== undefined) {
      const type = supportTypes[kind];
      if (type === undefined)
        throw new QueryError(`supportsLanguage(): kind must be audio, subtitles or interface, got ${kind}`);
      parts.push(`language_supports.language_support_type = ${type}`);
    }
    return new Condition(parts.join(" & "), parts.length > 1);
  },
};

/** The endpoint of each entity: `Platform` is read from `platforms`. */
const endpointOf = new Map<string, EndpointName>();
for (const [endpoint, { entity }] of Object.entries(endpoints) as [EndpointName, { entity: string }][])
  if (endpoint !== "search" && !endpointOf.has(entity)) endpointOf.set(entity, endpoint);

/** `named()` on the relation at `path`, to rows of `entity`. */
function named(path: string[], entity: string) {
  const field = path.join(".");
  return (...names: string[]): Condition => {
    if (names.length === 0) throw new QueryError(`${field}.named(): pass at least one name`);
    if (names.some((name) => typeof name !== "string" || name.trim() === ""))
      throw new QueryError(`${field}.named(): names must be non-empty strings`);
    const endpoint = endpointOf.get(entity);
    if (endpoint === undefined) throw new QueryError(`${field}.named(): ${entity} has no endpoint`);
    // The text IGDB would also accept, replaced by `field = (ids)` before sending (see NameLookup).
    const parts = names.map((name) => `${field}.name ~ ${literal(name.trim())}`);
    const text = parts.length === 1 ? parts.join("") : `(${parts.join(" | ")})`;
    return new Condition(text, false, [{ text, field, endpoint, names: names.map((name) => name.trim()) }]);
  };
}

/** Builds the proxy passed to `where(e => ...)`, validating each field against the schema. */
export function whereProxy(entity: string, path: string[] = []): unknown {
  return new Proxy(Object.create(null), {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      if (path.length === 0 && entity === "Game" && prop in gameFilters) {
        return gameFilters[prop as keyof GameFilters];
      }
      const fields = entities[entity];
      if (path.length > 0 && OPS.has(prop)) return filterOps(path.join("."))[prop];
      if (path.length > 0 && prop === "named" && fields && "name" in fields) return named(path, entity);
      if (!fields || !(prop in fields)) {
        throwIfRemoved(entity, prop, [...path, prop].join("."));
        throw new QueryError(`Unknown field "${[...path, prop].join(".")}" on ${entity}`);
      }
      const target = fields[prop];
      return target === 0
        ? filterOps([...path, prop].join("."), timestampFields[entity]?.includes(prop))
        : whereProxy(target as string, [...path, prop]);
    },
  });
}

/**
 * IGDB still accepts the fields it replaced, but leaves them empty or stops updating them, so a
 * filter on one silently matches nothing or too little (`where category = 0` matches no game).
 * Fails with the name of the replacement instead.
 */
export function throwIfRemoved(entity: string, field: string, path: string): void {
  const removed = removedFields[entity];
  if (!removed || !(field in removed)) return;
  const replacement = removed[field];
  throw new QueryError(
    replacement
      ? `"${path}" was replaced by IGDB and is empty or no longer updated: use "${replacement}" instead`
      : `"${path}" was dropped by IGDB and is always empty`,
  );
}
