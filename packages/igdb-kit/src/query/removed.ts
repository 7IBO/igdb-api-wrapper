import { type EndpointName, endpoints } from "../generated/schema";
import { findByLink } from "../links/by-game";
import { REFERENCE_TTL_MS } from "../links/expand";
import type { ExecuteOptions, Query, QueryState } from "./query";

/** A row IGDB no longer has, from `removed()`. */
export interface RemovedRow {
  id: number;
  /**
   * Why IGDB removed it, as its report says: `"Duplicate"`, `"Invalid"` or `"Violates policies"`.
   * Null when there is no report: most deletions have none, and only games, companies and game
   * localizations get reports.
   */
  reason: string | null;
  /**
   * The row that replaces a duplicate, following the chain when that one was removed too. Null when
   * there is none, or when the chain ends on a row that no longer exists.
   */
  replacement: number | null;
}

type Make = <R>(endpoint: EndpointName, state: QueryState) => Query<EndpointName, R>;

interface Report {
  id: number;
  source_item_id?: number;
  target_item_id?: number;
  report_type?: number;
  entity_type?: number;
}

/** Replacements followed at most: IGDB's longest chain of duplicates is far shorter. */
const MAX_CHAIN = 5;

/** @internal `query.removed()`. */
export async function removedRows(
  make: Make,
  endpoint: EndpointName,
  ids: readonly number[],
  options: ExecuteOptions,
): Promise<RemovedRow[]> {
  const batched = { ...options, batch: true };
  const missingOf = async (wanted: readonly number[]) => {
    const found = await make<{ id: number }>(endpoint, { fields: ["id"] })
      .findByIds(wanted)
      .execute(batched);
    const existing = new Set(found.map((row) => row.id));
    return [...new Set(wanted)].filter((id) => !existing.has(id));
  };
  const missing = await missingOf(ids);
  if (missing.length === 0) return [];

  const reference = (table: EndpointName) =>
    make<{ id: number; name?: string }>(table, {
      fields: ["id", "name"],
      sort: { field: "id", direction: "asc" },
      limit: 500,
      cacheTtlMs: REFERENCE_TTL_MS,
    }).execute(batched);
  const reportsOf = (sources: readonly number[]) =>
    findByLink(
      make<Report>("reports", { fields: ["source_item_id", "target_item_id", "report_type", "entity_type"] }),
      "source_item_id",
      sources,
      batched,
    );
  const [entityTypes, reportTypes, reports] = await Promise.all([
    reference("entity_types"),
    reference("report_types"),
    reportsOf(missing),
  ]);
  // "Game Localization" is the entity type of GameLocalization rows.
  const entity = endpoints[endpoint].entity.toLowerCase();
  const entityType = entityTypes.find((t) => t.name?.replace(/\s+/g, "").toLowerCase() === entity)?.id;
  const reasons = new Map(reportTypes.map((t) => [t.id, t.name ?? null]));
  /** The latest report on each id of this endpoint. */
  const latest = (byId: Map<number, Report[]>) => {
    const result = new Map<number, Report>();
    for (const [id, rows] of byId) {
      const own = rows.filter((row) => row.entity_type === entityType);
      const last = own.sort((a, b) => b.id - a.id)[0];
      if (entityType !== undefined && last) result.set(id, last);
    }
    return result;
  };

  const first = latest(reports);
  // Each removed id's replacement, followed while the replacement was removed too.
  const replacement = new Map<number, number | null>();
  for (const id of missing) replacement.set(id, first.get(id)?.target_item_id ?? null);
  for (let step = 0; ; step++) {
    const targets = [...new Set([...replacement.values()].filter((t): t is number => t !== null))];
    if (targets.length === 0) break;
    const gone = new Set(await missingOf(targets));
    if (gone.size === 0) break;
    const next = step < MAX_CHAIN ? latest(await reportsOf([...gone])) : new Map<number, Report>();
    for (const [id, target] of replacement) {
      if (target !== null && gone.has(target)) replacement.set(id, next.get(target)?.target_item_id ?? null);
    }
  }

  return missing.map((id) => {
    const report = first.get(id);
    return {
      id,
      reason: report?.report_type === undefined ? null : (reasons.get(report.report_type) ?? null),
      replacement: replacement.get(id) ?? null,
    };
  });
}
