import { IGDBError, PayloadTooLargeError, QueryError } from "../core/errors";
import type { Priority } from "../core/limiter";
import type { ExecuteOptions, QueryRequest, RawResponse } from "../query/query";

/** IGDB accepts at most 10 queries per multiquery. */
export const MAX_BLOCKS = 10;

export interface BatcherOptions {
  /** Group queries started at the same time into multiqueries. Default true. */
  autoBatch?: boolean | undefined;
  /** How long to wait for more queries before sending a batch. Default 2 ms. */
  batchWindowMs?: number | undefined;
  /**
   * Target size of one multiquery response. IGDB rejects responses above 10 MB (413), after spending
   * seconds building them, so batches stay well under. Default 4 MB.
   */
  maxBatchBytes?: number | undefined;
}

export type Send = (path: string, body: string, options: ExecuteOptions) => Promise<RawResponse>;

interface Entry {
  request: QueryRequest;
  key: string;
  priority: Priority;
  resolve: (response: RawResponse) => void;
  reject: (error: unknown) => void;
  estimate: number;
}

/**
 * Learns how many bytes one entity weighs for a given endpoint and field selection, so batches can
 * be sized by expected response size rather than by block count. Expansions (`cover.*`) are what
 * makes responses big: a game with every relation expanded weighs ~130 KB, with `name` only ~80 B.
 */
export class SizeEstimator {
  private readonly perEntity = new Map<string, number>();

  key(request: QueryRequest): string {
    return `${request.endpoint}|${[...request.fields].sort().join(",")}`;
  }

  estimate(request: QueryRequest): number {
    if (request.kind === "count") return 50;
    const learned = this.perEntity.get(this.key(request));
    return 100 + request.limit * (learned ?? this.guess(request.fields));
  }

  learn(request: QueryRequest, bytes: number, entities: number): void {
    if (entities === 0 || request.kind === "count") return;
    const key = this.key(request);
    const sample = bytes / entities;
    const previous = this.perEntity.get(key);
    this.perEntity.set(key, previous === undefined ? sample : previous * 0.7 + sample * 0.3);
  }

  /** Pessimistic first guess, corrected after the first response. */
  private guess(fields: readonly string[]): number {
    if (fields.length === 0) return 20; // ids only
    let bytes = 0;
    for (const field of fields) {
      const depth = field.split(".").length - 1;
      const wildcard = field.endsWith("*");
      if (depth === 0) bytes += wildcard ? 4500 : 60;
      else bytes += (wildcard ? 3000 : 400) * depth;
    }
    return bytes;
  }
}

/**
 * Collects queries started within a short window and sends them as multiqueries, so 30 queries
 * written one by one cost 3 HTTP requests instead of 30. Also deduplicates identical queries in flight.
 *
 * IGDB fails a whole multiquery when one block is invalid (400, without naming it) and when the
 * response exceeds 10 MB (413). Both are handled by splitting the batch in two and retrying each
 * half, so only the faulty query rejects. Queries using `search` are always sent alone: one search
 * block makes IGDB return an empty multiquery.
 */
export class Batcher {
  readonly sizes = new SizeEstimator();
  private readonly autoBatch: boolean;
  private readonly windowMs: number;
  private readonly maxBytes: number;
  private pending: Entry[] = [];
  private readonly pendingByKey = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<RawResponse>>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: Send,
    options: BatcherOptions = {},
  ) {
    this.autoBatch = options.autoBatch ?? true;
    this.windowMs = options.batchWindowMs ?? 2;
    this.maxBytes = options.maxBatchBytes ?? 4_000_000;
  }

  run(request: QueryRequest, options: ExecuteOptions = {}): Promise<RawResponse> {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    const batchable = (options.batch ?? this.autoBatch) && !request.hasSearch;
    const key = `${batchable ? "batch" : "direct"}\n${request.path}\n${request.body}`;
    const pending = this.pendingByKey.get(key);
    if (pending && options.priority !== "background") pending.priority = "interactive";

    // Identical queries pending or in flight share one request.
    let shared = this.inflight.get(key);
    if (!shared) {
      shared = batchable
        ? this.enqueue(request, key, options)
        : this.direct(request, { priority: options.priority });
      this.inflight.set(key, shared);
      const cleanup = () => this.inflight.delete(key);
      shared.then(cleanup, cleanup);
    }
    return withSignal(shared, options.signal);
  }

  private enqueue(request: QueryRequest, key: string, options: ExecuteOptions): Promise<RawResponse> {
    return new Promise<RawResponse>((resolve, reject) => {
      const entry: Entry = {
        request,
        key,
        priority: options.priority ?? "interactive",
        resolve,
        reject,
        estimate: this.sizes.estimate(request),
      };
      this.pendingByKey.set(key, entry);
      this.pending.push(entry);
      this.timer ??= setTimeout(() => this.flush(), this.windowMs);
    });
  }

  /** Sends what is pending now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const entries = this.pending;
    this.pending = [];
    this.pendingByKey.clear();
    for (const group of this.group(entries)) void this.sendGroup(group);
  }

  private async direct(request: QueryRequest, options: ExecuteOptions): Promise<RawResponse> {
    const response = await this.send(request.path, request.body, options);
    if (Array.isArray(response.data) && response.bytes) {
      this.sizes.learn(request, response.bytes, response.data.length);
    }
    return response;
  }

  /** Splits entries into groups of at most 10 blocks and `maxBatchBytes` of estimated response. */
  private group(entries: Entry[]): Entry[][] {
    const groups: Entry[][] = [];
    let current: Entry[] = [];
    let bytes = 0;
    // Biggest first, so large queries do not end up alone at the end of a batch of small ones.
    for (const entry of [...entries].sort((a, b) => b.estimate - a.estimate)) {
      if (current.length > 0 && (current.length >= MAX_BLOCKS || bytes + entry.estimate > this.maxBytes)) {
        groups.push(current);
        current = [];
        bytes = 0;
      }
      current.push(entry);
      bytes += entry.estimate;
    }
    if (current.length > 0) groups.push(current);
    return groups;
  }

  private async sendGroup(group: Entry[]): Promise<void> {
    const priority: Priority = group.some((e) => e.priority === "interactive") ? "interactive" : "background";
    if (group.length === 1) {
      const entry = group[0] as Entry;
      try {
        settle(entry, await this.direct(entry.request, { priority }));
      } catch (error) {
        fail(entry, error);
      }
      return;
    }

    const names = group.map((_, i) => `q${i}`);
    const body = group
      .map((entry, i) => `query ${entry.request.path} "${names[i]}" { ${entry.request.body} };`)
      .join("\n");
    let response: RawResponse;
    try {
      response = await this.send("multiquery", body, { priority });
    } catch (error) {
      const splittable =
        error instanceof PayloadTooLargeError || (error instanceof QueryError && error.status === 400);
      if (!splittable) {
        for (const entry of group) fail(entry, error);
        return;
      }
      // Isolate the faulty block (400) or shrink the response (413): retry each half.
      const middle = Math.ceil(group.length / 2);
      await Promise.all([this.sendGroup(group.slice(0, middle)), this.sendGroup(group.slice(middle))]);
      return;
    }

    const blocks = new Map<string, { result?: unknown[]; count?: number }>();
    for (const block of (response.data as { name: string; result?: unknown[]; count?: number }[]) ?? []) {
      blocks.set(block.name, block);
    }
    group.forEach((entry, i) => {
      const block = blocks.get(names[i] as string);
      if (!block) {
        fail(entry, new IGDBError(`Multiquery response has no block for ${entry.request.path}`));
        return;
      }
      if (entry.request.kind === "count") {
        settle(entry, { data: { count: block.count ?? 0 } });
        return;
      }
      const result = block.result ?? [];
      if (result.length > 0) this.sizes.learn(entry.request, JSON.stringify(result).length, result.length);
      settle(entry, { data: result });
    });
  }
}

function settle(entry: Entry, response: RawResponse): void {
  entry.resolve(response);
}

function fail(entry: Entry, error: unknown): void {
  entry.reject(error);
}

/** Lets one caller stop waiting on a shared request without cancelling it for the others. */
function withSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
