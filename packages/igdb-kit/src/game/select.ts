// Type-level checks that a query result has the fields a helper reads.
//
// Helpers take the object a query returns, whatever else was selected. Since every field of a
// result is optional, a plain parameter type such as `{ release_dates?: { date?: number }[] }` would
// also accept a result where `release_dates.date` was never selected, and the helper would silently
// see nothing. `Requires<T, Paths>` instead demands that each path exists in `T` (present or not at
// runtime), so a missing field is a compile error that names it.

/** A relation as IGDB returns it: an id, or an object with at least its id when expanded. */
export type Ref = number | { id: number };

type Head<P extends string> = P extends `${infer H}.${string}` ? H : P;
type Tail<P extends string, H extends string> = P extends `${H}.${infer R}` ? R : never;

/**
 * The shape `T` must have so that every field path `P` (`"release_dates.date"`, `"name"`) was
 * selected. Arrays are checked element by element; a relation left as an id fails when one of its
 * fields is required.
 */
export type Requires<T, P extends string, Prefix extends string = ""> = T extends readonly (infer U)[]
  ? readonly Requires<U, P, Prefix>[]
  : {
      [K in Head<P> & keyof T]?:
        | ([Tail<P, K & string>] extends [never]
            ? T[K]
            : Requires<NonNullable<T[K]>, Tail<P, K & string>, `${Prefix}${K & string}.`>)
        | undefined;
    } & {
      [K in Exclude<Head<P>, keyof T>]: Missing<Prefix, Extract<P, K | `${K & string}.${string}`>>;
    };

type Missing<Prefix extends string, P extends string> = P extends string
  ? `select("${Prefix}${P}") is missing`
  : never;

/** Like {@link Requires}, but only when the top-level field `K` is selected at all. */
export type RequiresIfSelected<T, K extends string, P extends string> = K extends keyof T
  ? Requires<T, P>
  : unknown;

/** The element type of an optional array field of `T`. */
export type ItemOf<T, K extends PropertyKey> = T extends { readonly [P in K]?: infer A }
  ? NonNullable<A> extends readonly (infer U)[]
    ? U
    : never
  : never;

/** The id of a relation, expanded or not. */
export function idOf(ref: Ref | undefined | null): number | undefined {
  if (ref == null) return undefined;
  return typeof ref === "object" ? ref.id : ref;
}

/** Positive counts only: IGDB stores 0 for "not filled in". */
export function positive(value: number | undefined | null): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}
