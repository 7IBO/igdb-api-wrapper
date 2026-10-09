import { QueryError } from "../core/errors";
import { type ParentRelation, parentGame } from "../game/relations";
import { idOf } from "../game/select";
import { CollectionMembershipType, CollectionRelationType, type EndpointName } from "../generated/schema";
import { findByLink } from "../links/by-game";
import { REFERENCE_TTL_MS } from "../links/expand";
import type { ExecuteOptions, Query, QueryState } from "./query";

/** @internal Builds a query on another endpoint with the client's runner. */
export type MakeQuery = <R>(endpoint: EndpointName, state: QueryState) => Query<EndpointName, R>;

type Row = Record<string, unknown> & { id: number };

/** A game's family, from {@link gameFamily}: every game is as the query selected it. */
export interface GameFamily<R> {
  game: R;
  /**
   * The game this one belongs to, by id: an `edition` of it (`version_parent`), or a DLC, mod, remake,
   * port... of it (`parent_game` with `game_type`). Null for a standalone game. Its own family is
   * one more `family()` call.
   */
  parent: { id: number; relation: ParentRelation; title: string | null } | null;
  /** Its editions (Gold, GOTY, Complete...): the games whose `version_parent` it is. */
  editions: R[];
  /**
   * Every game whose `parent_game` it is, with the relation its `game_type` gives: DLCs, expansions,
   * remakes, ports, and the mods, episodes, seasons, packs and updates that no field of the game lists.
   */
  children: { game: R; relation: ParentRelation }[];
  /** The bundles that contain it. */
  bundles: R[];
  /** The games it contains, when it is a bundle. */
  contents: R[];
  /** The series (`collections`) it is in, each with all its games. */
  series: { collection: { id: number; name: string }; games: { game: R; spinoff: boolean }[] }[];
}

/** A game of a series, from {@link seriesGames}. */
export interface SeriesGame<R> {
  game: R;
  /** The series or sub-series the game is in. */
  collection: { id: number; name: string };
  /** Whether it is a spin-off: a spin-off member, or in a spin-off series. */
  spinoff: boolean;
}

export interface SeriesOptions {
  /**
   * Also the games of its sub-series and story arcs, at every depth (`collection_relations`, read
   * once and cached for a day). Default false.
   */
  subseries?: boolean | undefined;
  /** Keep spin-offs: spin-off members and, with `subseries`, spin-off series. Default true. */
  spinoffs?: boolean | undefined;
}

/** A role of a company in a game, from `involved_companies`. */
export type CompanyRole = "developer" | "publisher" | "porting" | "supporting";

const ROLES: readonly CompanyRole[] = ["developer", "publisher", "porting", "supporting"];

/** A game of a company's catalog, from {@link companyCatalog}. */
export interface CatalogGame<R> {
  game: R;
  /** The roles the companies had in it, among those asked for. */
  roles: CompanyRole[];
  /** The companies involved in it: the company, or its subsidiaries. */
  companies: number[];
}

export interface CatalogOptions {
  /** The roles that put a game in the catalog. Default all four. */
  roles?: readonly CompanyRole[] | undefined;
  /** Also the games of its subsidiaries, at every depth (`companies.parent`). Default false. */
  includeSubsidiaries?: boolean | undefined;
}

/**
 * The selection of `state` with the fields a helper reads added, under `prefix` when the games come
 * expanded from another endpoint (`game.name`). `added` lists the fields to remove again from rows.
 */
function extended(
  state: QueryState,
  extra: readonly string[],
  prefix?: string,
): { fields: string[]; exclude: string[] | undefined; added: string[] } {
  const { fields } = state;
  const exclude = state.exclude ?? [];
  const returned = (field: string) =>
    fields.length > 0 &&
    !exclude.includes(field) &&
    fields.some((f) => f === "*" || f === field || f.startsWith(`${field}.`));
  const added = extra.filter((field) => !returned(field));
  const at = (field: string) => (prefix ? `${prefix}.${field}` : field);
  const own = fields.length > 0 ? fields : prefix ? ["id"] : [];
  const kept = exclude.filter((field) => !extra.includes(field)).map(at);
  return {
    fields: [...new Set([...own, ...added].map(at))],
    exclude: kept.length > 0 ? kept : undefined,
    added,
  };
}

/** A copy of the row without the fields a helper added: rows can be shared with other calls. */
function strip<R>(row: unknown, added: readonly string[]): R {
  if (added.length === 0) return row as R;
  const copy = { ...(row as Row) };
  for (const field of added) delete copy[field];
  return copy as R;
}

/** Release date order, undated games last, then id. */
function byDate(a: unknown, b: unknown): number {
  const x = (a as { first_release_date?: number }).first_release_date;
  const y = (b as { first_release_date?: number }).first_release_date;
  if (x !== y) {
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return x - y;
  }
  return (a as Row).id - (b as Row).id;
}

const DATE = ["first_release_date"];

/** @internal `igdb.games.family()`: six blocks sent together, which batching packs in one multiquery. */
export async function gameFamily<R>(
  games: Query<"games", R>,
  make: MakeQuery,
  id: number,
  options: ExecuteOptions,
): Promise<GameFamily<R> | null> {
  const batched = { ...options, batch: true };
  const { state } = games;
  const select = (x: { fields: string[]; exclude: string[] | undefined }) =>
    games.with({ fields: x.fields, exclude: x.exclude }) as unknown as Query<EndpointName, R>;
  const root = extended(state, ["game_type", "parent_game", "version_parent", "version_title"]);
  const list = extended(state, DATE);
  const child = extended(state, ["game_type", ...DATE]);
  const bundle = extended(state, DATE, "bundles");
  const member = extended(state, DATE, "game");
  const shared = { cacheTtlMs: state.cacheTtlMs };

  const [found, bundled, editions, children, contents, members] = await Promise.all([
    select(root).where(`id = ${id}`).limit(1).execute(batched),
    make<{ bundles?: Row[] }>("games", {
      ...shared,
      fields: bundle.fields,
      exclude: bundle.exclude,
      where: `id = ${id}`,
      limit: 1,
    }).execute(batched),
    findByLink(select(list), "version_parent", [id], batched),
    findByLink(select(child), "parent_game", [id], batched),
    findByLink(select(list), "bundles", [id], batched),
    findByLink(
      make<Membership>("collection_memberships", {
        ...shared,
        fields: ["type", "collection.name", ...member.fields],
        exclude: member.exclude,
      }),
      "collection.games",
      [id],
      batched,
    ),
  ]);
  const game = found[0];
  if (game === undefined) return null;

  const parent = parentGame(game as never) as {
    relation: ParentRelation;
    game: unknown;
    title: string | null;
  } | null;
  const parentId = idOf(parent?.game as never);
  const sorted = (rows: readonly unknown[] | undefined) => [...(rows ?? [])].sort(byDate);
  const editionIds = new Set((editions.get(id) ?? []).map((row) => (row as Row).id));

  const series = new Map<number, GameFamily<R>["series"][number]>();
  for (const row of sortedMembers(members.get(id) ?? [])) {
    const collection = row.collection;
    if (!row.game || !collection) continue;
    let entry = series.get(collection.id);
    if (!entry) {
      entry = { collection: { id: collection.id, name: collection.name ?? "" }, games: [] };
      series.set(collection.id, entry);
    }
    addMember(entry.games, strip(row.game, member.added), row.type === CollectionMembershipType.SpinOff);
  }

  return {
    game: strip(game, root.added),
    parent:
      parent && parentId !== undefined
        ? { id: parentId, relation: parent.relation, title: parent.title }
        : null,
    editions: sorted(editions.get(id)).map((row) => strip(row, list.added)),
    children: sorted(children.get(id))
      .filter((row) => !editionIds.has((row as Row).id))
      .map((row) => ({
        game: strip(row, child.added),
        relation: (parentGame({ game_type: (row as Row).game_type, parent_game: id } as never)?.relation ??
          "other") as ParentRelation,
      })),
    bundles: sorted(bundled[0]?.bundles).map((row) => strip(row, bundle.added)),
    contents: sorted(contents.get(id)).map((row) => strip(row, list.added)),
    series: [...series.values()].sort((a, b) => a.collection.id - b.collection.id),
  };
}

interface Membership {
  id: number;
  type?: number;
  collection?: { id: number; name?: string };
  game?: Row;
}

/** Memberships in release order of their games, undated last. */
function sortedMembers(rows: readonly Membership[]): Membership[] {
  return rows.filter((row) => row.game).sort((a, b) => byDate(a.game, b.game));
}

/** Adds a game once; a member entry wins over a spin-off one. */
function addMember<R>(games: { game: R; spinoff: boolean }[], game: R, spinoff: boolean): void {
  const id = (game as Row).id;
  const existing = games.find((entry) => (entry.game as Row).id === id);
  if (!existing) games.push({ game, spinoff });
  else if (existing.spinoff && !spinoff) existing.spinoff = false;
}

/** @internal `igdb.games.series()`. */
export async function seriesGames<R>(
  games: Query<"games", R>,
  make: MakeQuery,
  collectionId: number,
  options: SeriesOptions & ExecuteOptions,
): Promise<SeriesGame<R>[]> {
  const { subseries = false, spinoffs = true, ...execute } = options;
  const batched = { ...execute, batch: true };
  const { state } = games;
  const shared = { cacheTtlMs: state.cacheTtlMs };

  // The series, then its sub-series level by level; a spin-off series makes its games spin-offs.
  const collections = [collectionId];
  const spinoffSeries = new Set<number>();
  if (subseries) {
    const relations = make<{ parent_collection?: number; child_collection?: number; type?: number }>(
      "collection_relations",
      { fields: ["parent_collection", "child_collection", "type"], cacheTtlMs: REFERENCE_TTL_MS },
    );
    const all: { parent_collection?: number; child_collection?: number; type?: number }[] = [];
    for await (const page of relations.cursorPages(execute)) all.push(...page);
    for (let i = 0; i < collections.length; i++) {
      const parent = collections[i] as number;
      for (const relation of all) {
        const child = relation.child_collection;
        if (relation.parent_collection !== parent || child === undefined || collections.includes(child))
          continue;
        const spinoff = spinoffSeries.has(parent) || relation.type === CollectionRelationType.SpinOffSeries;
        if (spinoff && !spinoffs) continue;
        if (spinoff) spinoffSeries.add(child);
        collections.push(child);
      }
    }
  }

  const member = extended(state, DATE, "game");
  const members = await findByLink(
    make<Membership>("collection_memberships", {
      ...shared,
      fields: ["type", "collection.name", ...member.fields],
      exclude: member.exclude,
    }),
    "collection",
    collections,
    batched,
  );
  const result: SeriesGame<R>[] = [];
  const byGame = new Map<number, SeriesGame<R>>();
  for (const id of collections) {
    for (const row of members.get(id) ?? []) {
      if (!row.game || !row.collection) continue;
      const spinoff = spinoffSeries.has(id) || row.type === CollectionMembershipType.SpinOff;
      if (spinoff && !spinoffs) continue;
      const existing = byGame.get(row.game.id);
      if (existing) {
        if (existing.spinoff && !spinoff) existing.spinoff = false;
        continue;
      }
      const entry = {
        game: row.game as unknown as R,
        collection: { id: row.collection.id, name: row.collection.name ?? "" },
        spinoff,
      };
      byGame.set(row.game.id, entry);
      result.push(entry);
    }
  }
  return result
    .sort((a, b) => byDate(a.game, b.game))
    .map((entry) => ({ ...entry, game: strip(entry.game, member.added) }));
}

/** @internal `igdb.games.catalog()`. */
export async function companyCatalog<R>(
  games: Query<"games", R>,
  make: MakeQuery,
  companyId: number,
  options: CatalogOptions & ExecuteOptions,
): Promise<CatalogGame<R>[]> {
  const { roles = ROLES, includeSubsidiaries = false, ...execute } = options;
  const wanted = ROLES.filter((role) => roles.includes(role));
  if (wanted.length === 0) throw new QueryError(`catalog() needs roles among ${ROLES.join(", ")}`);
  const batched = { ...execute, batch: true };
  const { state } = games;
  const shared = { cacheTtlMs: state.cacheTtlMs };

  // The company, then its subsidiaries level by level.
  const companies = [companyId];
  if (includeSubsidiaries) {
    const children = make<Row>("companies", { ...shared, fields: ["id"] });
    for (let level = [companyId]; level.length > 0; ) {
      const found = await findByLink(children, "parent", level, batched, "catalog()");
      level = [];
      for (const rows of found.values()) {
        for (const row of rows) {
          if (companies.includes(row.id)) continue;
          companies.push(row.id);
          level.push(row.id);
        }
      }
    }
  }

  const member = extended(state, DATE, "game");
  const rows = await findByLink(
    make<Row & { game?: Row }>("involved_companies", {
      ...shared,
      fields: [...wanted, ...member.fields],
      exclude: member.exclude,
      // Combined with the company filter, the query wraps it in parentheses.
      where: wanted.map((role) => `${role} = true`).join(" | "),
    }),
    "company",
    companies,
    batched,
    "catalog()",
  );
  const byGame = new Map<number, CatalogGame<R>>();
  for (const company of companies) {
    for (const row of rows.get(company) ?? []) {
      if (!row.game) continue;
      let entry = byGame.get(row.game.id);
      if (!entry) {
        entry = { game: row.game as unknown as R, roles: [], companies: [] };
        byGame.set(row.game.id, entry);
      }
      for (const role of wanted)
        if (row[role] === true && !entry.roles.includes(role)) entry.roles.push(role);
      if (!entry.companies.includes(company)) entry.companies.push(company);
    }
  }
  return [...byGame.values()]
    .sort((a, b) => byDate(a.game, b.game))
    .map((entry) => ({
      ...entry,
      roles: ROLES.filter((role) => entry.roles.includes(role)),
      game: strip(entry.game, member.added),
    }));
}
