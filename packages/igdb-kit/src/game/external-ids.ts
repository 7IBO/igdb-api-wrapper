import { ExternalGameSource } from "../generated/schema";
import { idOf, type Ref, type Requires } from "./select";

/** Fields of `external_games` that {@link externalIds} reads; `external_games.url` too when selected. */
export type ExternalIdFields = "external_games.external_game_source" | "external_games.uid";

interface ExternalGameRow {
  external_game_source?: Ref | undefined;
  uid?: string | undefined;
  url?: string | undefined;
}

/** A game whose selection lets {@link externalIds} work. */
export interface ExternalIdsInput {
  external_games?: readonly ExternalGameRow[] | undefined;
}

export interface ExternalId {
  /** `ExternalGameSource` id: `ExternalGameSource.Steam` (1), `GOG` (5), `Microsoft` (11)... */
  source: number;
  /** The game's id in that source: a Steam appid, a GOG product id, a Microsoft Store product id. */
  uid: string;
  /** IGDB's link to the product, when selected; null when IGDB has none. */
  url: string | null;
}

/**
 * The ids of a game in other services (stores, Twitch, GiantBomb...), one per product, in IGDB's
 * order. A game can have several ids in one source (versions, regions, older products): 1,830 games
 * have two or three Steam appids. The other way, an id belongs to one game only within its source,
 * so `findByExternalIds()` is never ambiguous.
 *
 * What IGDB cannot link: PlayStation trophies (its PlayStation ids are store concept ids, never
 * CUSA, PPSA or NPWR), and Nintendo, Ubisoft, EA and Battle.net, which are not sources. Its YouTube
 * ids are channels, so their link is built to the channel instead of IGDB's broken video link.
 *
 * ```ts
 * const game = await igdb.games.select("external_games.external_game_source", "external_games.uid").findByIdOrThrow(1942);
 * externalIds(game, ExternalGameSource.GOG).map((e) => e.uid); // ["1207664663", "1207664643"]
 * ```
 */
export function externalIds<G extends object>(
  game: G & Requires<G, ExternalIdFields>,
  source?: number,
): ExternalId[] {
  const ids = new Map<string, ExternalId>();
  for (const row of (game as ExternalIdsInput).external_games ?? []) {
    const rowSource = idOf(row.external_game_source);
    if (rowSource === undefined || !row.uid || (source !== undefined && rowSource !== source)) continue;
    const key = `${rowSource} ${row.uid}`;
    const kept = ids.get(key);
    if (kept) {
      kept.url ??= row.url ?? null;
      continue;
    }
    let url = row.url ?? null;
    if (rowSource === ExternalGameSource.Youtube && /^UC[\w-]{22}$/.test(row.uid))
      url = `https://www.youtube.com/channel/${row.uid}`;
    ids.set(key, { source: rowSource, uid: row.uid, url });
  }
  return [...ids.values()];
}

/**
 * The game's first id in a source, or null: `externalId(game, ExternalGameSource.Steam)` is
 * `"292030"` for The Witcher 3. See {@link externalIds} for all of them.
 */
export function externalId<G extends object>(
  game: G & Requires<G, ExternalIdFields>,
  source: number,
): string | null {
  return externalIds(game as never, source)[0]?.uid ?? null;
}
