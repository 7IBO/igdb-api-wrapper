import { type Game, GameType } from "../generated/schema";
import type { Selection } from "../links/selection";
import type { FieldPath } from "../query/types";
import { type ItemOf, idOf, type Ref, type Requires } from "./select";

/** Fields that {@link parentGame} reads. */
export type ParentGameFields = "game_type" | "parent_game" | "version_parent";

/** A game whose selection lets {@link parentGame} work. */
export interface ParentGameInput {
  game_type?: Ref | undefined;
  parent_game?: Ref | undefined;
  version_parent?: Ref | undefined;
  version_title?: string | undefined;
}

/**
 * How a game relates to its parent: an `edition` of it (`version_parent`: Gold, GOTY, Complete
 * editions...), or, from `game_type`, content that needs or reworks it (`parent_game`).
 */
export type ParentRelation =
  | "edition"
  | "dlc"
  | "expansion"
  | "standalone_expansion"
  | "mod"
  | "episode"
  | "season"
  | "remake"
  | "remaster"
  | "expanded_game"
  | "port"
  | "fork"
  | "pack"
  | "update"
  | "other";

const relations: Record<number, ParentRelation> = {
  [GameType.DLC]: "dlc",
  [GameType.Expansion]: "expansion",
  [GameType.StandaloneExpansion]: "standalone_expansion",
  [GameType.Mod]: "mod",
  [GameType.Episode]: "episode",
  [GameType.Season]: "season",
  [GameType.Remake]: "remake",
  [GameType.Remaster]: "remaster",
  [GameType.ExpandedGame]: "expanded_game",
  [GameType.Port]: "port",
  [GameType.Fork]: "fork",
  [GameType.PackAddon]: "pack",
  [GameType.Update]: "update",
};

export interface ParentGame<P> {
  relation: ParentRelation;
  /** The parent as selected: an id, or an object with the fields selected under it. */
  game: P;
  /** `version_title` of an edition ("Complete Edition"), when selected; missing on 1.5% of editions. */
  title: string | null;
}

type ParentOf<G, K extends string> = G extends { readonly [P in K]?: infer V } ? NonNullable<V> : never;

/**
 * The game this one belongs to, or null for a standalone game. An edition (`version_parent`, set
 * on 2% of games, Witcher 3 Complete Edition for instance) wins over `parent_game` (DLCs, mods,
 * remakes, ports...: 15% of games), which IGDB sets together on 201 games. A parent deleted from
 * IGDB disappears from an expanded relation, so it reads as no parent.
 *
 * ```ts
 * const dlc = await igdb.games.select("game_type", "parent_game.name", "version_parent.name", "version_title").findByIdOrThrow(240009);
 * parentGame(dlc); // { relation: "expansion", game: { id: 119133, name: "Elden Ring" }, title: null }
 * ```
 */
export function parentGame<G extends object>(
  game: G & Requires<G, ParentGameFields>,
): ParentGame<ParentOf<G, "version_parent"> | ParentOf<G, "parent_game">> | null {
  const input = game as ParentGameInput;
  let parent: ParentGame<Ref> | null = null;
  if (input.version_parent !== undefined) {
    parent = { relation: "edition", game: input.version_parent, title: input.version_title ?? null };
  } else if (input.parent_game !== undefined) {
    const type = idOf(input.game_type);
    parent = { relation: relations[type ?? -1] ?? "other", game: input.parent_game, title: null };
  }
  return parent as ParentGame<never> | null;
}

/** The arrays of a game that list the games it relates to, from IGDB's `games` fields. */
const relatedLists = [
  "dlcs",
  "expansions",
  "standalone_expansions",
  "remakes",
  "remasters",
  "expanded_games",
  "ports",
  "forks",
  "bundles",
] as const;

type RelatedList = (typeof relatedLists)[number];
type RelatedRef = "parent_game" | "version_parent" | RelatedList;

/** Fields that {@link relatedGames} reads. */
export type RelatedGameFields = ParentGameFields | RelatedList;

/**
 * The fields {@link relatedGames} reads, to spread into `select()`: the related games as ids, or
 * with the fields you name selected on each of them and on the parent.
 *
 * ```ts
 * const game = await igdb.games.select("name", ...relatedGameFields("name", "cover.image_id")).findByIdOrThrow(1942);
 * relatedGames(game).expansions.map((g) => g.name); // ["The Witcher 3: Wild Hunt - Blood and Wine", ...]
 * ```
 */
export function relatedGameFields<F extends string = never>(
  ...fields: FieldPath<Game, F>[]
): Selection<
  "games",
  "game_type" | "version_title" | ([F] extends [never] ? RelatedRef : `${RelatedRef}.${F}`)
> {
  const refs: readonly string[] = ["parent_game", "version_parent", ...relatedLists];
  const paths = fields.length === 0 ? refs : refs.flatMap((ref) => fields.map((field) => `${ref}.${field}`));
  return Object.freeze(["game_type", "version_title", ...paths]) as never;
}

/** The games a game relates to, as selected: ids, or objects with the fields selected under them. */
export type RelatedGames<G> = {
  /** The game this one belongs to, as {@link parentGame} gives it. */
  parent: ParentGame<ParentOf<G, "version_parent"> | ParentOf<G, "parent_game">> | null;
} & { [K in RelatedList]: ItemOf<G, K>[] };

/**
 * The games a game relates to, from its own fields, with no request: its parent (the game it is
 * an edition, a DLC, a remake, a port... of), then its DLCs, expansions, standalone expansions,
 * remakes, remasters, expanded games, ports and forks, and the bundles that contain it. Lists are
 * empty, never undefined. Each array is the exact reverse of `parent_game` for one game type, so a
 * remake lists nothing back: the original lists it in `remakes`.
 *
 * What the game's fields cannot show: its editions (`version_parent` points the other way, and the
 * parent lists none in 85% of cases), its mods, episodes, seasons, packs and updates (no array lists
 * them), and the content of a bundle. These need a query of the games that point to it.
 *
 * ```ts
 * const game = await igdb.games.select("name", ...relatedGameFields("name")).findByIdOrThrow(1020);
 * relatedGames(game).expanded_games; // [{ id: 334254, name: "Grand Theft Auto V Enhanced" }]
 * ```
 */
export function relatedGames<G extends object>(game: G & Requires<G, RelatedGameFields>): RelatedGames<G> {
  const input = game as ParentGameInput & { readonly [K in RelatedList]?: readonly Ref[] | undefined };
  const related: Record<string, unknown> = { parent: parentGame(game as never) };
  for (const list of relatedLists) related[list] = [...(input[list] ?? [])];
  return related as RelatedGames<G>;
}

export interface GroupByParentOptions {
  /**
   * The relations that put a game in its parent's group. Default `["edition", "port"]`: the Gold and
   * GOTY editions and the ports of a game, which a catalog shows as one entry. Add `"remaster"`,
   * `"expanded_game"`, `"dlc"`... to group those too.
   */
  relations?: readonly ParentRelation[] | undefined;
}

export interface GameGroup<G> {
  /** The original, or a game whose parent is not in the list. */
  game: G;
  /** The games of the list that belong to it, directly or through another member, in list order. */
  members: { game: G; relation: ParentRelation }[];
}

export interface GroupedGames<G> {
  /** One group per original, where the first of its games comes in the list. */
  groups: GameGroup<G>[];
  /**
   * Parents that are not in the list, by id: a group whose game is an edition or a port stands for
   * a parent you can load with `findByIds()`, then group again.
   */
  missingParents: number[];
}

/**
 * Groups the editions and ports of a list of games (a company's catalog, search results, a
 * player's library) under their original, with no request. A game whose parent is missing from the
 * list keeps its own group, and the parent's id goes to `missingParents`. Games come once, by id.
 *
 * ```ts
 * const games = await igdb.games.select("name", "game_type", "parent_game", "version_parent", "version_title")
 *   .where((g) => g.developedBy(1012)).limit(500);
 * const { groups } = groupByParent(games);
 * groups.map((g) => `${g.game.name} (${g.members.length} editions and ports)`);
 * ```
 */
export function groupByParent<G extends { id: number }>(
  games: readonly (G & Requires<G, ParentGameFields>)[],
  options: GroupByParentOptions = {},
): GroupedGames<G> {
  const grouped = new Set<ParentRelation>(options.relations ?? ["edition", "port"]);
  const byId = new Map<number, G>();
  for (const game of games) if (!byId.has(game.id)) byId.set(game.id, game);

  // The parent each game joins, when its relation is grouped and the parent is in the list.
  const parentIds = new Map<number, { parent: number; relation: ParentRelation }>();
  const missing = new Set<number>();
  for (const [id, game] of byId) {
    const parent = parentGame(game as never) as ParentGame<Ref> | null;
    const parentId = idOf(parent?.game);
    if (!parent || parentId === undefined || parentId === id || !grouped.has(parent.relation)) continue;
    if (byId.has(parentId)) parentIds.set(id, { parent: parentId, relation: parent.relation });
    else missing.add(parentId);
  }

  // IGDB has no cycles, but a list mixing stale rows could: the first game of one keeps its group.
  for (const id of byId.keys()) {
    const seen = new Set<number>();
    for (
      let current = parentIds.get(id)?.parent;
      current !== undefined;
      current = parentIds.get(current)?.parent
    ) {
      if (current === id) parentIds.delete(id);
      if (current === id || seen.has(current)) break;
      seen.add(current);
    }
  }
  const rootOf = (id: number): number => {
    let current = id;
    for (let next = parentIds.get(current); next; next = parentIds.get(current)) current = next.parent;
    return current;
  };

  const groups = new Map<number, GameGroup<G>>();
  for (const [id, game] of byId) {
    const root = rootOf(id);
    let group = groups.get(root);
    if (!group) {
      group = { game: byId.get(root) as G, members: [] };
      groups.set(root, group);
    }
    const link = parentIds.get(id);
    if (link) group.members.push({ game, relation: link.relation });
  }
  return { groups: [...groups.values()], missingParents: [...missing] };
}

/** Fields that {@link franchisesOf} reads. */
export type FranchiseFields = "franchise" | "franchises";

export interface GameFranchises<F> {
  /**
   * The main franchise: `franchise`, which IGDB sets on 1,348 games only, else the game's only
   * franchise. Null when the game has none, or several and none of them is the main one.
   */
  main: F | null;
  /** The other franchises, in IGDB's order. */
  others: F[];
}

/**
 * The franchises of a game, the main one apart. IGDB sets `franchise` on 1,348 games and
 * `franchises` on 29,259 (the main one is always among them), so reading `franchise` alone misses
 * almost every franchise. A franchise is a commercial universe, wider than a series (`collections`):
 * the Mario franchise has 949 games, the Super Mario series 123, and Super Smash Bros. is in the
 * Zelda franchise.
 *
 * ```ts
 * const game = await igdb.games.select("franchise.name", "franchises.name").findByIdOrThrow(1942);
 * franchisesOf(game); // { main: { id: 452, name: "The Witcher" }, others: [] }
 * ```
 */
export function franchisesOf<G extends object>(
  game: G & Requires<G, FranchiseFields>,
): GameFranchises<ItemOf<G, "franchises"> | ParentOf<G, "franchise">> {
  const input = game as { franchise?: Ref | undefined; franchises?: readonly Ref[] | undefined };
  const all = input.franchises ?? [];
  const mainId = idOf(input.franchise);
  let main: Ref | null = null;
  if (mainId !== undefined)
    main = all.find((franchise) => idOf(franchise) === mainId) ?? input.franchise ?? null;
  else if (all.length === 1) main = all[0] ?? null;
  const others = all.filter((franchise) => main === null || idOf(franchise) !== idOf(main));
  return { main, others } as never;
}
