import { QueryError } from "../core/errors";
import { type EndpointName, GameType } from "../generated/schema";
import type { ExecuteOptions, Query } from "./query";
import type { MakeQuery } from "./related";
import { literal } from "./where";

/** What `games.match()` looks for. */
export interface MatchInput {
  /** The title as a store or a list writes it: "DARK SOULS™ III", "Pokémon Épée", "NieR:Automata". */
  name: string;
  /**
   * Platforms the game is on, by id (`Platform.PS5`) or by name, abbreviation or alternative name
   * ("PS5", "Nintendo Switch"). Games released on none of them score lower.
   */
  platforms?: number | string | readonly (number | string)[] | undefined;
  /** The year it came out, on `platforms` when given. Games released in another year score lower. */
  year?: number | undefined;
  /** Lowest score returned, 0 to 1. Default 0.5. */
  minScore?: number | undefined;
}

/** A candidate of `games.match()`. */
export interface GameMatch<R> {
  game: R;
  /**
   * 0 to 1. 1: the title is the game's name and the platforms and year, when given, agree. 0.97: it
   * is one of its alternative or localized titles. 0.95: the name without an edition or platform
   * ("GOTY Edition", "(PS5)"). Below 0.9, the title only resembles it. Times 0.7 when the game is on
   * none of the platforms, 0.9 or 0.6 when it came out a year or more apart, 0.9 when IGDB lacks the
   * platforms or dates, 0.9 for mods, forks and updates.
   */
  score: number;
  /** The title that matched: the game's name, or one of its alternative or localized titles. */
  title: string;
  matched: "name" | "alternative_name" | "localized_name";
}

/** The fields scored, read for up to 50 games per block. */
const SCORED = [
  "name",
  "game_type",
  "version_parent",
  "total_rating_count",
  "first_release_date",
  "platforms",
  "release_dates.date",
  "release_dates.platform",
];

/** The fields of a selection read from the scored rows, without another request. */
const READ = new Set([
  "id",
  "name",
  "game_type",
  "version_parent",
  "total_rating_count",
  "first_release_date",
  "platforms",
]);

/** Rows read per block. */
const CANDIDATES = 50;

/** Game types that are not products a store sells. */
const NOT_SOLD = new Set<number>([GameType.Mod, GameType.Fork, GameType.Update]);

/** Ranked after other games of the same score, and editions after them: content of another game, or not sold. */
const MINOR = new Set<number>([
  GameType.DLC,
  GameType.Episode,
  GameType.Season,
  GameType.PackAddon,
  ...NOT_SOLD,
]);

interface ScoredGame {
  id: number;
  name?: string;
  game_type?: number;
  version_parent?: number;
  total_rating_count?: number;
  first_release_date?: number;
  platforms?: number[];
  release_dates?: { date?: number; platform?: number }[];
}

interface TitleRow {
  name?: string;
  game?: ScoredGame;
}

interface Candidate {
  game: ScoredGame;
  titles: { title: string; kind: GameMatch<unknown>["matched"] }[];
}

/**
 * @internal Runs `games.match()`: searches the cleaned title and the title without its edition (each
 * alone: IGDB answers a search block of a multiquery with nothing), and reads the games,
 * alternative names and localized titles equal to them in one multiquery; then the best candidates
 * are read with `query`'s fields and `where`, unless the scored rows already hold the selection.
 */
export async function matchGames<R>(
  query: Query<"games", R>,
  make: MakeQuery,
  input: MatchInput,
  limit: number,
  platformIds: (names: string[], execute: ExecuteOptions) => Promise<number[]>,
  execute: ExecuteOptions,
): Promise<GameMatch<R>[]> {
  const { name, year, minScore = 0.5 } = input ?? {};
  if (typeof name !== "string" || name.trim() === "")
    throw new QueryError("match(): name must be a non-empty string");
  if (year !== undefined && !Number.isInteger(year))
    throw new QueryError(`match(): year must be an integer, got ${year}`);
  if (typeof minScore !== "number" || !(minScore >= 0 && minScore <= 1))
    throw new QueryError(`match(): minScore must be between 0 and 1, got ${minScore}`);
  const wanted = input.platforms === undefined ? [] : [input.platforms].flat();
  if (wanted.some((p) => (typeof p === "string" ? p.trim() === "" : !Number.isSafeInteger(p))))
    throw new QueryError("match(): platforms must be ids or non-empty names");
  const names = wanted.filter((p): p is string => typeof p === "string").map((p) => p.trim());
  if (limit === 0) return [];

  const raw = name.trim().replace(/\s+/g, " ");
  const cleaned = clean(raw);
  const base = withoutEdition(cleaned);
  // IGDB's search needs every word, punctuation included: "NieR:Automata" finds nothing.
  const loose = base.replace(/[^\p{L}\p{N}'&]+/gu, " ").trim();
  const batch = { ...execute, batch: true };
  const scored = query.with({ fields: SCORED, exclude: undefined, limit: CANDIDATES });
  const equal = [...new Set([raw, cleaned, base])].map((title) => `name ~ ${literal(title)}`).join(" | ");
  const titleRows = (endpoint: EndpointName) =>
    make<TitleRow>(endpoint, {
      fields: ["name", ...SCORED.map((field) => `game.${field}`)],
      where: equal,
      limit: CANDIDATES,
    }).execute(batch);
  const [searched, searchedLoose, named, alternatives, localized, platforms] = await Promise.all([
    cleaned === "" ? [] : (scored.search(cleaned).execute(batch) as Promise<unknown[]>),
    loose === "" || loose === cleaned ? [] : (scored.search(loose).execute(batch) as Promise<unknown[]>),
    scored.where(equal).execute(batch) as Promise<unknown[]>,
    titleRows("alternative_names"),
    titleRows("game_localizations"),
    names.length > 0 ? platformIds(names, execute) : [],
  ]);

  const candidates = new Map<number, Candidate>();
  const add = (
    game: ScoredGame | undefined,
    title?: string,
    kind?: "alternative_name" | "localized_name",
  ) => {
    // A row of a deleted game has no expanded game.
    if (!game?.name) return;
    let candidate = candidates.get(game.id);
    if (!candidate) {
      candidate = { game, titles: [{ title: game.name, kind: "name" }] };
      candidates.set(game.id, candidate);
    }
    if (title && kind) candidate.titles.push({ title, kind });
  };
  for (const game of [...searched, ...searchedLoose, ...named] as ScoredGame[]) add(game);
  for (const row of alternatives) add(row.game, row.name, "alternative_name");
  for (const row of localized) add(row.game, row.name, "localized_name");

  const variants = [{ key: titleKey(cleaned), weight: 1 }];
  if (titleKey(base) !== variants[0]?.key) variants.push({ key: titleKey(base), weight: 0.95 });
  const onPlatforms = new Set([...wanted.filter((p): p is number => typeof p === "number"), ...platforms]);
  const ranked = [...candidates.values()]
    .map(({ game, titles }) => {
      let best = { title: game.name as string, kind: "name" as GameMatch<R>["matched"], score: 0 };
      for (const { title, kind } of titles) {
        const score = similarity(variants, titleKey(title)) * (kind === "name" ? 1 : 0.97);
        if (score > best.score) best = { title, kind, score };
      }
      const factor =
        platformFactor(game, onPlatforms) *
        yearFactor(game, onPlatforms, year) *
        (NOT_SOLD.has(game.game_type ?? -1) ? 0.9 : 1);
      return { game, ...best, score: Math.round(best.score * factor * 1000) / 1000 };
    })
    .filter((match) => match.score >= minScore)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(MINOR.has(a.game.game_type ?? -1)) - Number(MINOR.has(b.game.game_type ?? -1)) ||
        Number(a.game.version_parent !== undefined) - Number(b.game.version_parent !== undefined) ||
        (b.game.total_rating_count ?? 0) - (a.game.total_rating_count ?? 0) ||
        a.game.id - b.game.id,
    );

  const { fields, exclude, where } = query.state;
  if (!where && !exclude?.length && fields.every((field) => READ.has(field))) {
    return ranked.slice(0, limit).map(({ game, title, kind, score }) => {
      const picked = fields.flatMap((field) =>
        field in game ? [[field, game[field as keyof ScoredGame]]] : [],
      );
      return { game: Object.fromEntries([["id", game.id], ...picked]) as R, score, title, matched: kind };
    });
  }
  // The query's `where` applies here too, to games found by their other titles: read spares.
  const wantedIds = ranked.slice(0, where ? CANDIDATES : limit).map((match) => match.game.id);
  const games = await query.with({ limit: undefined }).findByIds(wantedIds).execute(execute);
  const byId = new Map(games.map((game) => [(game as { id: number }).id, game]));
  return ranked
    .flatMap(({ game, title, kind, score }) => {
      const read = byId.get(game.id);
      return read === undefined ? [] : [{ game: read, score, title, matched: kind }];
    })
    .slice(0, limit);
}

/** Without trademark signs and repeated spaces: "DARK SOULS™ III" -> "DARK SOULS III". */
function clean(title: string): string {
  return title
    .replace(/[™®©℠]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const EDITION_WORDS =
  "game of the year|goty|digital deluxe|deluxe|complete|definitive|ultimate|gold|premium|standard|special|collector'?s|launch|day one|day 1|enhanced|anniversary|legendary";

/** Trailing edition and platform labels, after a separator or not: " - GOTY Edition", "(PS5)". */
const SUFFIXES = [
  /\s*[([][^)\]]*[)\]]\s*$/,
  new RegExp(`\\s*[-–—:,]?\\s*\\b(?:the\\s+)?(?:(?:${EDITION_WORDS})\\s+)+(?:edition|version)\\s*$`, "i"),
  /\s*[-–—:,]?\s*\b(?:goty|director'?s cut)\s*$/i,
  /\s*[-–—:,]?\s*\b(?:PS4|PS5|PS4\s*(?:&|and|\/)\s*PS5|Xbox One|Xbox Series X\|S|Nintendo Switch)(?:\s+edition)?\s*$/i,
];

/** The title without its trailing edition and platform labels, or the title when that leaves nothing. */
function withoutEdition(title: string): string {
  let base = title;
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of SUFFIXES) {
      const next = base.replace(suffix, "");
      if (next !== base && next.trim() !== "") {
        base = next.trim();
        changed = true;
      }
    }
  }
  return base;
}

/** Roman numerals of sequels, as words: "Final Fantasy VII" is "final fantasy 7". "I" and "X" stay. */
const ROMAN: Record<string, string> = Object.fromEntries(
  ["ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"]
    .map((numeral, i) => [numeral, String(i + 2)])
    .concat(["xi", "xii", "xiii", "xiv", "xv", "xvi"].map((numeral, i) => [numeral, String(i + 11)])),
);

/**
 * The form titles are compared in: lower case, without accents, trademark signs, apostrophes or
 * punctuation, with sequel numerals as digits and "GOTY" spelled out.
 */
function titleKey(title: string): string {
  return title
    .replace(/[™®©℠]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((word) => ROMAN[word] ?? (word === "goty" ? "game of the year" : word))
    .join(" ");
}

/** The best score of a title against the variants of the input: 1 equal, below 0.9 resembling. */
function similarity(variants: readonly { key: string; weight: number }[], key: string): number {
  let best = 0;
  for (const variant of variants) {
    if (variant.key === key) return Math.max(best, variant.weight);
    // A sequel number that differs makes another game: "Doom" and "Doom 3".
    const numbers = sameNumbers(variant.key, key) ? 1 : 0.6;
    best = Math.max(best, variant.weight * 0.9 * dice(variant.key, key) * numbers);
  }
  return best;
}

/** Sørensen–Dice coefficient of the letter pairs, spaces left out. */
function dice(a: string, b: string): number {
  const pairs = (text: string) => {
    const compact = text.replace(/ /g, "");
    const counts = new Map<string, number>();
    for (let i = 0; i < compact.length - 1; i++) {
      const pair = compact.slice(i, i + 2);
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    return { counts, size: Math.max(compact.length - 1, 0) };
  };
  const x = pairs(a);
  const y = pairs(b);
  if (x.size + y.size === 0) return 0;
  let shared = 0;
  for (const [pair, count] of x.counts) shared += Math.min(count, y.counts.get(pair) ?? 0);
  return (2 * shared) / (x.size + y.size);
}

function sameNumbers(a: string, b: string): boolean {
  const numbers = (text: string) => (text.match(/\d+/g) ?? []).sort().join(" ");
  return numbers(a) === numbers(b);
}

/** 1 on one of the platforms, 0.7 on none of them, 0.9 when IGDB lists no platform. */
function platformFactor(game: ScoredGame, platforms: ReadonlySet<number>): number {
  if (platforms.size === 0) return 1;
  const on = [...(game.platforms ?? []), ...(game.release_dates ?? []).flatMap((d) => d.platform ?? [])];
  if (on.length === 0) return 0.9;
  return on.some((platform) => platforms.has(platform)) ? 1 : 0.7;
}

/**
 * 1 when the game came out that year (on the platforms, when it has dates there), 0.9 a year apart
 * or without dates, 0.6 further apart.
 */
function yearFactor(game: ScoredGame, platforms: ReadonlySet<number>, year: number | undefined): number {
  if (year === undefined) return 1;
  const dated = (game.release_dates ?? []).filter((d) => d.date !== undefined);
  const onPlatforms = dated.filter((d) => d.platform !== undefined && platforms.has(d.platform));
  const dates = (onPlatforms.length > 0 ? onPlatforms : dated).map((d) => d.date as number);
  if (dates.length === 0 && game.first_release_date !== undefined) dates.push(game.first_release_date);
  if (dates.length === 0) return 0.9;
  const apart = Math.min(...dates.map((date) => Math.abs(new Date(date * 1000).getUTCFullYear() - year)));
  return apart === 0 ? 1 : apart === 1 ? 0.9 : 0.6;
}
