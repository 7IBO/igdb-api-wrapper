import { idOf, positive, type Ref, type Requires } from "./select";

/** Fields of `multiplayer_modes` that {@link multiplayer} reads (`multiplayer_modes.*` covers them). */
export type MultiplayerFields =
  | "multiplayer_modes.platform"
  | "multiplayer_modes.onlinemax"
  | "multiplayer_modes.onlinecoop"
  | "multiplayer_modes.onlinecoopmax"
  | "multiplayer_modes.offlinemax"
  | "multiplayer_modes.offlinecoop"
  | "multiplayer_modes.offlinecoopmax"
  | "multiplayer_modes.lancoop"
  | "multiplayer_modes.splitscreen"
  | "multiplayer_modes.dropin"
  | "multiplayer_modes.campaigncoop";

interface MultiplayerModeRow {
  platform?: Ref | undefined;
  onlinemax?: number | undefined;
  onlinecoop?: boolean | undefined;
  onlinecoopmax?: number | undefined;
  offlinemax?: number | undefined;
  offlinecoop?: boolean | undefined;
  offlinecoopmax?: number | undefined;
  lancoop?: boolean | undefined;
  splitscreen?: boolean | undefined;
  dropin?: boolean | undefined;
  campaigncoop?: boolean | undefined;
}

/** A game whose selection lets {@link multiplayer} work. */
export interface MultiplayerInput {
  multiplayer_modes?: readonly MultiplayerModeRow[] | undefined;
}

/**
 * Multiplayer support on one platform. Player counts are undefined when unknown: IGDB stores 0 or
 * nothing for "not filled in" (on 64% to 80% of rows depending on the field), never "none".
 */
export interface Multiplayer {
  /** `Platform` id; undefined for a row that applies to every platform (18% of rows). */
  platform: number | undefined;
  /** Most players in online multiplayer. */
  onlineMax: number | undefined;
  onlineCoop: boolean | undefined;
  /** Most players in online co-op. */
  onlineCoopMax: number | undefined;
  /** Most players in offline (local) multiplayer. */
  offlineMax: number | undefined;
  offlineCoop: boolean | undefined;
  /** Most players in offline (local) co-op. */
  offlineCoopMax: number | undefined;
  lanCoop: boolean | undefined;
  /** Offline split screen. */
  splitscreen: boolean | undefined;
  /** Players can join and leave a running game. */
  dropIn: boolean | undefined;
  /** The campaign can be played in co-op. */
  campaignCoop: boolean | undefined;
}

/**
 * Multiplayer support per platform from `multiplayer_modes`, which only 5.7% of main games have:
 * an empty list means unknown, not single-player. With a platform, its row, else the row that
 * applies to every platform, else null.
 *
 * ```ts
 * const game = await igdb.games.select("multiplayer_modes.*").findByIdOrThrow(1121); // Watch Dogs
 * multiplayer(game, Platform.XboxOne); // { onlineMax: 8, onlineCoop: true, onlineCoopMax: undefined, ... }
 * ```
 */
export function multiplayer<G extends object>(game: G & Requires<G, MultiplayerFields>): Multiplayer[];
export function multiplayer<G extends object>(
  game: G & Requires<G, MultiplayerFields>,
  platform: number,
): Multiplayer | null;
export function multiplayer(game: MultiplayerInput, platform?: number): Multiplayer[] | Multiplayer | null {
  const modes = (game.multiplayer_modes ?? []).map(toMultiplayer);
  if (platform === undefined) return modes;
  return modes.find((m) => m.platform === platform) ?? modes.find((m) => m.platform === undefined) ?? null;
}

function toMultiplayer(row: MultiplayerModeRow): Multiplayer {
  return {
    platform: idOf(row.platform),
    onlineMax: positive(row.onlinemax),
    onlineCoop: row.onlinecoop,
    onlineCoopMax: positive(row.onlinecoopmax),
    offlineMax: positive(row.offlinemax),
    offlineCoop: row.offlinecoop,
    offlineCoopMax: positive(row.offlinecoopmax),
    lanCoop: row.lancoop,
    splitscreen: row.splitscreen,
    dropIn: row.dropin,
    campaignCoop: row.campaigncoop,
  };
}
