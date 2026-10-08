// Type-level machinery for field paths and result inference.
//
// Entities are plain interfaces where a relation is typed as the target entity (`cover: Cover`,
// `platforms: Platform[]`). IGDB returns a relation as an id unless one of its sub-fields is selected,
// and omits empty or null fields, so the result of a query is derived from the selected paths:
//   - every field except `id` is optional,
//   - a relation without selected sub-fields is an id (or an array of ids),
//   - a relation with selected sub-fields is a nested object (or array of objects) with its own `id`.

type Scalar = string | number | boolean;

export type Unarray<T> = T extends readonly (infer U)[] ? U : T;

/** Keys of `E` that are relations to another entity. */
export type RelationKeys<E> = {
  [K in keyof E]-?: Unarray<E[K]> extends Scalar ? never : K;
}[keyof E] &
  string;

/** Keys of `E` that hold a scalar or an array of scalars. */
export type ScalarKeys<E> = Exclude<keyof E & string, RelationKeys<E>>;

/**
 * Validates one field path and drives autocompletion one segment at a time, so the set of valid
 * paths is never expanded eagerly (IGDB entities are deeply recursive: games -> dlcs -> games ...).
 * Accepts `name`, `cover.image_id`, `involved_companies.company.name`, `*`, `cover.*`.
 */
export type FieldPath<E, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends RelationKeys<E>
    ? `${Head}.${FieldPath<Unarray<E[Head]>, Rest>}`
    : FieldPathSuggestions<E>
  : P extends (keyof E & string) | "*"
    ? P
    : FieldPathSuggestions<E>;

type FieldPathSuggestions<E> = (keyof E & string) | "*" | `${RelationKeys<E>}.${string}`;

/** Same as {@link FieldPath} but only paths ending on a scalar field, for `sort`. */
export type ScalarPath<E, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends RelationKeys<E>
    ? `${Head}.${ScalarPath<Unarray<E[Head]>, Rest>}`
    : ScalarPathSuggestions<E>
  : P extends ScalarKeys<E>
    ? P
    : ScalarPathSuggestions<E>;

type ScalarPathSuggestions<E> = ScalarKeys<E> | `${RelationKeys<E>}.${string}`;

type TopLevelKeys<E, P extends string> = "*" extends P
  ? keyof E
  : (P extends `${infer Head}.${string}` ? Head : P) & keyof E;

type SubPaths<P extends string, K extends string> = P extends `${K}.${infer Rest}` ? Rest : never;

type IdOf<T> = T extends readonly unknown[] ? number[] : number;

type FieldResult<T, Sub extends string> = [Sub] extends [never]
  ? Unarray<T> extends Scalar
    ? T
    : IdOf<T>
  : T extends readonly (infer U)[]
    ? SelectResult<U, Sub>[]
    : SelectResult<T, Sub>;

/** The object IGDB returns for entity `E` when the fields `P` are selected. */
export type SelectResult<E, P extends string> = Prettify<
  { id: number } & {
    [K in Exclude<TopLevelKeys<E, P>, "id">]?: FieldResult<E[K], SubPaths<P, K & string>>;
  }
>;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};
