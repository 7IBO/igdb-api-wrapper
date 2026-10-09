import type { EndpointName, Endpoints } from "../generated/schema";
import { endpointEntity, validatePath } from "../query/query";
import type { FieldPath, SelectResult, Unarray } from "../query/types";

declare const selectionEndpoint: unique symbol;

/**
 * Field paths of one endpoint kept under a name, from `defineSelection()`. Spread it into `select()`
 * (`igdb.games.select(...card, "summary")`) or a view's `select`; `ResultOf<typeof card>` is the shape
 * of a row selected with it.
 */
export type Selection<N extends EndpointName, P extends string> = readonly P[] & {
  /** @internal Type-only: the endpoint the paths belong to. */
  readonly [selectionEndpoint]?: N;
};

/**
 * Names a reusable set of fields, checked like `select()`, so a "card" shape can be shared between
 * queries, views and your own types:
 *
 * ```ts
 * const gameCard = defineSelection("games", "name", "cover.image_id", "platforms.abbreviation");
 * type GameCard = ResultOf<typeof gameCard>;
 * const games = await igdb.games.select(...gameCard, "summary").limit(10);
 * ```
 */
export function defineSelection<N extends EndpointName, P extends string>(
  endpoint: N,
  ...fields: FieldPath<Endpoints[N], P>[]
): Selection<N, P> {
  for (const field of fields) validatePath(endpointEntity(endpoint), field, false);
  return Object.freeze([...new Set(fields as P[])]) as Selection<N, P>;
}

/**
 * The type of one result of a selection, a query, a view or anything awaitable: `ResultOf<typeof
 * gameCard>`, `ResultOf<typeof query>` (one row, not the array), `ResultOf<typeof gamePage>`.
 */
export type ResultOf<T> =
  T extends PromiseLike<infer U>
    ? NonNullable<Unarray<U>>
    : T extends Selection<infer N, infer P>
      ? SelectResult<Endpoints[N], P>
      : never;
