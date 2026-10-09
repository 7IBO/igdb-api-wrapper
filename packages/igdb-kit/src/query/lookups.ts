import { NotFoundError, QueryError } from "../core/errors";
import { type ExecuteOptions, MAX_BODY_BYTES, Query, type QueryRequest, type QueryRunner } from "./query";
import { literal } from "./where";

/** How long a company name lookup is cached: a day, like the reference tables of `expand()`. */
const LOOKUP_TTL_MS = 24 * 3600_000;

interface Company {
  id: number;
  name?: string;
  developed?: number[];
  published?: number[];
}

/** Most suggestions listed for a name that matches no company. */
const SUGGESTIONS = 5;

/**
 * @internal The request with its company names replaced by ids. Each distinct name is one cached
 * `companies` query, all sent together so batching packs them, and each name filter becomes
 * `involved_companies.company = (ids)`. A name that matches no company throws a `NotFoundError`
 * with the companies that contain it, those with the most games first ("Ubisoft" suggests
 * "Ubisoft Entertainment" and "Ubisoft Montreal" before small studios).
 */
export async function resolveLookups(
  request: QueryRequest,
  runner: QueryRunner,
  options: ExecuteOptions = {},
): Promise<QueryRequest> {
  const lookups = request.lookups ?? [];
  if (lookups.length === 0) return request;
  const send: ExecuteOptions = { signal: options.signal, priority: options.priority };
  const companies = new Query<"companies", Company>(runner, "companies", {
    fields: ["id"],
    limit: 500,
    cacheTtlMs: LOOKUP_TTL_MS,
  });
  const names = [...new Set(lookups.flatMap((lookup) => lookup.names))];
  const found = await Promise.all(
    names.map((name) => companies.where(`name ~ ${literal(name)}`).execute(send)),
  );
  const idsOf = new Map(names.map((name, i) => [name, (found[i] ?? []).map((company) => company.id)]));

  const missing = names.filter((name) => idsOf.get(name)?.length === 0);
  if (missing.length > 0) {
    // The oldest 500 companies that contain the name, ranked by their number of games.
    const close = await Promise.all(
      missing.map((name) =>
        companies
          .with({ fields: ["name", "developed", "published"], sort: { field: "id", direction: "asc" } })
          .where(`name ~ *${literal(name)}*`)
          .execute(send),
      ),
    );
    const games = (company: Company) => (company.developed?.length ?? 0) + (company.published?.length ?? 0);
    const ranked = close.flatMap((matches) =>
      [...matches].sort((a, b) => games(b) - games(a)).slice(0, SUGGESTIONS),
    );
    const suggestions = [...new Set(ranked.flatMap((company) => (company.name ? [company.name] : [])))];
    const list = (values: string[]) => values.map((value) => `"${value}"`).join(", ");
    throw new NotFoundError(
      `No company named ${list(missing)}${suggestions.length > 0 ? `. Close names: ${list(suggestions)}` : ""}`,
      { endpoint: "companies", query: request.body, suggestions },
    );
  }

  let body = request.body;
  // Longest first: the filter of several names contains the filter of each one.
  for (const lookup of [...lookups].sort((a, b) => b.text.length - a.text.length)) {
    const ids = [...new Set(lookup.names.flatMap((name) => idsOf.get(name) ?? []))].sort((a, b) => a - b);
    body = body.split(lookup.text).join(`${lookup.field} = (${ids.join(",")})`);
  }
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_BODY_BYTES) {
    throw new QueryError(
      `Query body is ${bytes} bytes once company names are replaced by ids, above IGDB's limit of ${MAX_BODY_BYTES}`,
      { endpoint: request.endpoint },
    );
  }
  return { ...request, body, lookups: undefined };
}
