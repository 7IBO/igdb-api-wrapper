import { QueryError } from "../core/errors";
import {
  type Character,
  type Collection,
  type Game,
  GameType,
  type Platform,
  type Theme,
} from "../generated/schema";
import { type ExecuteOptions, MAX_LIMIT, type Query } from "./query";
import type { FieldPath, Prettify, SelectResult } from "./types";

/**
 * Kinds of entity the `search` endpoint indexes. It also has rows for people, an entity the API no
 * longer exposes, and no company at all, even though the schema has a `company` field.
 */
export type SearchKind = "game" | "character" | "collection" | "platform" | "theme";

export const SEARCH_KINDS: readonly SearchKind[] = ["game", "character", "collection", "platform", "theme"];

interface KindEntities {
  game: Game;
  character: Character;
  collection: Collection;
  platform: Platform;
  theme: Theme;
}

/**
 * Game types searchAll() keeps by default: main games, their remakes, remasters, ports and expanded
 * re-releases, and expansions. Mods, forks, DLCs, bundles, episodes, seasons, packs and updates
 * outnumber main games in most searches (153 mods out of 381 game hits for "zelda").
 */
export const SEARCH_GAME_TYPES: readonly number[] = [
  GameType.MainGame,
  GameType.Expansion,
  GameType.StandaloneExpansion,
  GameType.Remake,
  GameType.Remaster,
  GameType.ExpandedGame,
  GameType.Port,
];

/** Selected paths per kind; a kind without a selection gets its `name`. */
export type SearchSelection = { [K in SearchKind]: string };

/** One result of `searchAll()`, narrowed by `kind`. */
export type SearchHit<
  K extends SearchKind = SearchKind,
  P extends SearchSelection = SearchSelection,
> = K extends SearchKind
  ? Prettify<
      {
        kind: K;
        /** Id of the game, character, collection, platform or theme. */
        id: number;
        /** Its display name ("Final Fantasy VII", where IGDB's search index has "Final Fantasy 7"). */
        name: string;
        /**
         * The alternative names IGDB matched against, joined with spaces into one string ("Geralt
         * Gwynbleidd Butcher of Blaviken White Wolf"). Missing when there are none.
         */
        alternative_name?: string;
        /** Whether the term was found in the name or only in the alternative names. */
        matched: "name" | "alternative_name";
      } & { [Q in K]: SelectResult<KindEntities[K], P[K] | "name"> }
    >
  : never;

export interface SearchAllOptions extends ExecuteOptions {
  /** Kinds to return. Default: all of them. */
  kinds?: readonly SearchKind[] | undefined;
  /** Number of hits, 1 to 500. Default 10. */
  limit?: number | undefined;
  /**
   * Game types to keep, or `"all"`. Default {@link SEARCH_GAME_TYPES}, which leaves out mods, DLCs and
   * the like. Fan games are main games in IGDB and cannot be told apart.
   */
  gameTypes?: readonly number[] | "all" | undefined;
  /** Keep editions of a game (`version_parent` set, such as a "Complete Edition"). Default false. */
  editions?: boolean | undefined;
  /**
   * `relevance` (default) reads every match, up to `maxRows`, and ranks it: exact name, then names
   * starting with the term, then names containing its words, then alternative names; ties go to the
   * games with the most ratings, then to shorter names. `igdb` keeps IGDB's own order, in one request:
   * the most recently indexed first (last week's mods before the original), or its own text score once
   * game hits are filtered by type or edition. Both drop rows whose entity IGDB deleted, so `igdb` can
   * return fewer than `limit` hits.
   */
  order?: "relevance" | "igdb" | undefined;
  /** With `relevance`, read at most this many matches, 500 per request. Default 2000. */
  maxRows?: number | undefined;
}

/** `searchAll()`, as declared on the client. */
export type SearchAll = <
  K extends SearchKind = SearchKind,
  PG extends string = never,
  PC extends string = never,
  PS extends string = never,
  PP extends string = never,
  PT extends string = never,
>(
  term: string,
  options?: SearchAllOptions & {
    kinds?: readonly K[] | undefined;
    /** Fields to return for each kind, as paths relative to it: `{ game: ["name", "cover.image_id"] }`. */
    select?: {
      game?: readonly FieldPath<Game, PG>[];
      character?: readonly FieldPath<Character, PC>[];
      collection?: readonly FieldPath<Collection, PS>[];
      platform?: readonly FieldPath<Platform, PP>[];
      theme?: readonly FieldPath<Theme, PT>[];
    };
  },
) => Promise<SearchHit<K, { game: PG; character: PC; collection: PS; platform: PP; theme: PT }>[]>;

interface SearchRow {
  id: number;
  name?: string;
  alternative_name?: string;
  game?: { id: number; name?: string; total_rating_count?: number };
  character?: { id: number; name?: string };
  collection?: { id: number; name?: string };
  platform?: { id: number; name?: string };
  theme?: { id: number; name?: string };
}

/** @internal Runs `searchAll()` on the client's `search` endpoint. */
export async function searchAll(
  endpoint: Query<"search">,
  term: string,
  options: SearchAllOptions & { select?: Partial<Record<SearchKind, readonly string[]>> } = {},
): Promise<SearchHit[]> {
  const {
    kinds = SEARCH_KINDS,
    select = {},
    limit = 10,
    gameTypes = SEARCH_GAME_TYPES,
    editions = false,
    order = "relevance",
    maxRows = 2000,
    ...execute
  } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new QueryError(`limit must be an integer between 1 and ${MAX_LIMIT}, got ${limit}`);
  }
  if (kinds.length === 0 || kinds.some((kind) => !SEARCH_KINDS.includes(kind))) {
    throw new QueryError(`kinds must be some of ${SEARCH_KINDS.join(", ")}, got ${kinds.join(", ")}`);
  }
  if (gameTypes !== "all" && (gameTypes.length === 0 || !gameTypes.every(Number.isSafeInteger))) {
    throw new QueryError(`gameTypes must be "all" or a non-empty list of game type ids`);
  }
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new QueryError(`maxRows must be a positive integer`);
  // IGDB answers an empty term with no rows.
  if (normalize(term) === "") return [];

  const relevance = order === "relevance";
  const fields = ["name", "alternative_name"];
  for (const kind of kinds) {
    fields.push(`${kind}.name`, ...(select[kind] ?? []).map((path) => `${kind}.${path}`));
  }
  const rating = "game.total_rating_count";
  const keepRating = fields.includes(rating) || fields.includes("game.*");
  if (relevance && kinds.includes("game") && !keepRating) fields.push(rating);

  // A row whose entity was deleted still passes `!= null` (23 of 25 collections behind "pokemon"):
  // the expansion then leaves the field out, and such rows are dropped below.
  const filters = kinds.map((kind) => {
    if (kind !== "game") return `${kind} != null`;
    const parts = ["game != null"];
    if (gameTypes !== "all") parts.push(`game.game_type = (${gameTypes.join(",")})`);
    if (!editions) parts.push("game.version_parent = null");
    return parts.length > 1 ? `(${parts.join(" & ")})` : parts[0];
  });
  const query = endpoint
    .select(...(fields as never[]))
    .search(term)
    .where(filters.join(" | "));

  let rows: SearchRow[];
  if (relevance) {
    const first = await query.limit(MAX_LIMIT).withCount().execute(execute);
    // x-count is exact on this endpoint, also with a where.
    const end = Math.min(first.total, Math.max(maxRows, MAX_LIMIT));
    const pages = [];
    for (let offset = MAX_LIMIT; offset < end; offset += MAX_LIMIT) {
      pages.push(query.limit(MAX_LIMIT).offset(offset).execute(execute));
    }
    rows = [first.data, ...(await Promise.all(pages))].flat() as SearchRow[];
  } else {
    rows = (await query.limit(limit).execute(execute)) as SearchRow[];
  }

  const words = normalize(term).split(" ");
  const ranked: { hit: SearchHit; tier: number; ratings: number; index: number }[] = [];
  rows.forEach((row, index) => {
    const kind = kinds.find((k) => row[k] !== undefined);
    const entity = kind && row[kind];
    if (!kind || !entity) return;
    const name = entity.name ?? row.name ?? "";
    const alternative = row.alternative_name || undefined;
    const tier = Math.min(nameTier(name, words), nameTier(row.name ?? "", words));
    const inAlternative = tier === 3 && alternative !== undefined && containsWords(alternative, words);
    const ratings = (kind === "game" && row.game?.total_rating_count) || 0;
    // The rating count was only added to rank: a copy drops it, since an identical search in flight
    // shares these rows.
    let shown: { id: number; total_rating_count?: number } = entity;
    if (kind === "game" && !keepRating) {
      shown = { ...entity };
      delete shown.total_rating_count;
    }
    const hit = {
      kind,
      id: entity.id,
      name,
      ...(alternative === undefined ? {} : { alternative_name: alternative }),
      matched: inAlternative ? "alternative_name" : "name",
      [kind]: shown,
    } as SearchHit;
    ranked.push({ hit, tier: inAlternative ? 3 : tier === 3 ? 4 : tier, ratings, index });
  });
  if (relevance) {
    ranked.sort(
      (a, b) =>
        a.tier - b.tier ||
        b.ratings - a.ratings ||
        a.hit.name.length - b.hit.name.length ||
        a.index - b.index,
    );
  }
  return ranked.slice(0, limit).map((r) => r.hit);
}

/** Lower case, without accents or punctuation: "Pokémon: Red" -> "pokemon red". */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Every word of the term starts a word of the text, as IGDB matches them. */
function containsWords(text: string, words: string[]): boolean {
  const padded = ` ${normalize(text)}`;
  return words.every((word) => padded.includes(` ${word}`));
}

/** 0 exact name, 1 name starting with the term, 2 name containing its words, 3 neither. */
function nameTier(name: string, words: string[]): number {
  const normalized = normalize(name);
  const term = words.join(" ");
  if (normalized === term) return 0;
  if (normalized.startsWith(term)) return 1;
  return containsWords(name, words) ? 2 : 3;
}
