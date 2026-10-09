import { GameType } from "../generated/schema";
import { idOf, type Ref, type Requires } from "./select";

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
  title: string | undefined;
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
 * parentGame(dlc); // { relation: "expansion", game: { id: 119133, name: "Elden Ring" }, title: undefined }
 * ```
 */
export function parentGame<G extends object>(
  game: G & Requires<G, ParentGameFields>,
): ParentGame<ParentOf<G, "version_parent"> | ParentOf<G, "parent_game">> | null {
  const input = game as ParentGameInput;
  let parent: ParentGame<Ref> | null = null;
  if (input.version_parent !== undefined) {
    parent = { relation: "edition", game: input.version_parent, title: input.version_title };
  } else if (input.parent_game !== undefined) {
    const type = idOf(input.game_type);
    parent = { relation: relations[type ?? -1] ?? "other", game: input.parent_game, title: undefined };
  }
  return parent as ParentGame<never> | null;
}
