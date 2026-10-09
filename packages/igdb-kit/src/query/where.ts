import { QueryError } from "../core/errors";
import { entities, removedFields } from "../generated/schema";
import type { TimestampKeys } from "./types";

type Scalar = string | number | boolean;
type Value = Scalar | Date;

/** A compiled `where` condition. Combine with `.and()` / `.or()` or the {@link and} / {@link or} helpers. */
export class Condition {
  /** @internal */
  constructor(
    readonly text: string,
    private readonly composite = false,
  ) {}

  and(...others: Condition[]): Condition {
    return and(this, ...others);
  }

  or(...others: Condition[]): Condition {
    return or(this, ...others);
  }

  /** @internal Text safe to embed inside another `&` / `|` expression. */
  get operand(): string {
    return this.composite ? `(${this.text})` : this.text;
  }

  toString(): string {
    return this.text;
  }
}

function join(op: "&" | "|", conditions: Condition[]): Condition {
  if (conditions.length === 0) throw new QueryError("and()/or() need at least one condition");
  if (conditions.length === 1) return conditions[0] as Condition;
  return new Condition(conditions.map((c) => c.operand).join(` ${op} `), true);
}

export const and = (...conditions: Condition[]): Condition => join("&", conditions);
export const or = (...conditions: Condition[]): Condition => join("|", conditions);

interface NullFilter {
  /** `field = null`: the field is absent. */
  isNull(): Condition;
  /** `field != null`: the field is present. */
  notNull(): Condition;
}

export interface NumberFilter<T extends number = number> extends NullFilter {
  eq(value: T): Condition;
  ne(value: T): Condition;
  gt(value: number): Condition;
  gte(value: number): Condition;
  lt(value: number): Condition;
  lte(value: number): Condition;
  /** `field = (a, b)`: equals any of the values. */
  in(...values: T[]): Condition;
  /** `field != (a, b)`: equals none of the values. */
  notIn(...values: T[]): Condition;
}

/**
 * Filters on a Unix-timestamp field. IGDB counts in seconds; a `Date` is converted for you, so
 * `gte(new Date())` never compares milliseconds to seconds.
 */
export interface TimestampFilter extends NullFilter {
  eq(value: number | Date): Condition;
  ne(value: number | Date): Condition;
  gt(value: number | Date): Condition;
  gte(value: number | Date): Condition;
  lt(value: number | Date): Condition;
  lte(value: number | Date): Condition;
  in(...values: (number | Date)[]): Condition;
  notIn(...values: (number | Date)[]): Condition;
}

export interface StringFilter extends NullFilter {
  eq(value: string): Condition;
  ne(value: string): Condition;
  in(...values: string[]): Condition;
  notIn(...values: string[]): Condition;
  /** `field ~ "value"*` (case-insensitive unless `caseSensitive`). */
  startsWith(value: string, options?: { caseSensitive?: boolean }): Condition;
  /** `field ~ *"value"` (case-insensitive unless `caseSensitive`). */
  endsWith(value: string, options?: { caseSensitive?: boolean }): Condition;
  /** `field ~ *"value"*` (case-insensitive unless `caseSensitive`). */
  contains(value: string, options?: { caseSensitive?: boolean }): Condition;
}

export interface BooleanFilter extends NullFilter {
  eq(value: boolean): Condition;
  ne(value: boolean): Condition;
}

/** Filters on array fields. For relations the values are ids. */
export interface ArrayFilter<T extends Scalar> extends NullFilter {
  /** `field = (a, b)`: contains at least one of the values. */
  any(...values: T[]): Condition;
  /** `field = [a, b]`: contains all of the values. */
  all(...values: T[]): Condition;
  /** `field != (a, b)`: contains none of the values. */
  none(...values: T[]): Condition;
  /** `field = ![a, b]`: does not contain all of the values. */
  notAll(...values: T[]): Condition;
  /** `field = {a, b}`: contains exactly these values. Does not work on ids. */
  exactly(...values: T[]): Condition;
}

type FieldFilter<T> = [T] extends [readonly (infer U)[]]
  ? U extends Scalar
    ? ArrayFilter<U>
    : ArrayFilter<number> & WhereFields<U>
  : [T] extends [string]
    ? StringFilter
    : [T] extends [number]
      ? NumberFilter<T>
      : [T] extends [boolean]
        ? BooleanFilter
        : NumberFilter & WhereFields<T>;

/**
 * The argument of `where(e => ...)`. Each field exposes the filters valid for its type; a relation can
 * be filtered by id or by one of its own fields (`g.platforms.name.eq("PC")`). Filtering three levels
 * deep makes IGDB time out: resolve the id first instead.
 */
export type WhereFields<E> = {
  readonly [K in keyof E & string]-?: K extends TimestampKeys<E> ? TimestampFilter : FieldFilter<E[K]>;
};

function literal(value: Value | null): string {
  if (value === null) return "null";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new QueryError("Invalid Date in where");
    return String(toUnix(value));
  }
  if (typeof value === "string") return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new QueryError(`Invalid number in where: ${value}`);
  }
  return String(value);
}

const list = (values: Value[], open: string, close: string) => {
  if (values.length === 0) throw new QueryError("Expected at least one value");
  return `${open}${values.map(literal).join(",")}${close}`;
};

function filterOps(path: string): Record<string, (...args: never[]) => Condition> {
  const c = (rest: string) => new Condition(`${path} ${rest}`);
  const text = (value: string, before: string, after: string, options?: { caseSensitive?: boolean }) =>
    c(`${options?.caseSensitive ? "=" : "~"} ${before}${literal(value)}${after}`);
  return {
    isNull: () => c("= null"),
    notNull: () => c("!= null"),
    eq: (v: Value) => c(`= ${literal(v)}`),
    ne: (v: Value) => c(`!= ${literal(v)}`),
    gt: (v: number | Date) => c(`> ${literal(v)}`),
    gte: (v: number | Date) => c(`>= ${literal(v)}`),
    lt: (v: number | Date) => c(`< ${literal(v)}`),
    lte: (v: number | Date) => c(`<= ${literal(v)}`),
    in: (...v: Value[]) => c(`= ${list(v, "(", ")")}`),
    notIn: (...v: Value[]) => c(`!= ${list(v, "(", ")")}`),
    any: (...v: Scalar[]) => c(`= ${list(v, "(", ")")}`),
    all: (...v: Scalar[]) => c(`= ${list(v, "[", "]")}`),
    none: (...v: Scalar[]) => c(`!= ${list(v, "(", ")")}`),
    notAll: (...v: Scalar[]) => c(`= ${list(v, "![", "]")}`),
    exactly: (...v: Scalar[]) => c(`= ${list(v, "{", "}")}`),
    startsWith: (v: string, o?: { caseSensitive?: boolean }) => text(v, "", "*", o),
    endsWith: (v: string, o?: { caseSensitive?: boolean }) => text(v, "*", "", o),
    contains: (v: string, o?: { caseSensitive?: boolean }) => text(v, "*", "*", o),
  };
}

const OPS = new Set(Object.keys(filterOps("")));

/** Builds the proxy passed to `where(e => ...)`, validating each field against the schema. */
export function whereProxy(entity: string, path: string[] = []): unknown {
  return new Proxy(Object.create(null), {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      const fields = entities[entity];
      if (path.length > 0 && OPS.has(prop)) return filterOps(path.join("."))[prop];
      if (!fields || !(prop in fields)) {
        throwIfRemoved(entity, prop, [...path, prop].join("."));
        throw new QueryError(`Unknown field "${[...path, prop].join(".")}" on ${entity}`);
      }
      const target = fields[prop];
      return target === 0 ? scalarProxy([...path, prop]) : whereProxy(target as string, [...path, prop]);
    },
  });
}

function scalarProxy(path: string[]): unknown {
  return filterOps(path.join("."));
}

/**
 * IGDB still accepts the fields it replaced, but leaves them empty or stops updating them, so a
 * filter on one silently matches nothing or too little (`where category = 0` matches no game).
 * Fails with the name of the replacement instead.
 */
export function throwIfRemoved(entity: string, field: string, path: string): void {
  const removed = removedFields[entity];
  if (!removed || !(field in removed)) return;
  const replacement = removed[field];
  throw new QueryError(
    replacement
      ? `"${path}" was replaced by IGDB and is empty or no longer updated: use "${replacement}" instead`
      : `"${path}" was dropped by IGDB and is always empty`,
  );
}

/** IGDB timestamps are Unix seconds: `toUnix(new Date())` for a filter value. Rounds down. */
export function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** A `Date` from an IGDB timestamp (Unix seconds), such as `first_release_date`. */
export function toDate(seconds: number): Date {
  return new Date(seconds * 1000);
}
