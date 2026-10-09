import type { ExecuteOptions, RawResponse } from "../query/query";
import type { TokenProvider } from "./auth";
import { errorFromResponse, IGDBError, type IGDBErrorOptions, NetworkError, RateLimitError } from "./errors";
import type { Limiter } from "./limiter";
import { backoffDelay, sleep } from "./util";

/** One request, as `hooks.onRequest` reports it. */
export interface RequestLog {
  /** The path requested: `games`, `games/count`, `multiquery`, `webhooks`... */
  path: string;
  method: "GET" | "POST" | "DELETE";
  /** The HTTP status, or 0 when no answer came (network error, timeout, abort). */
  status: number;
  /** From sending the request to reading the whole response, in milliseconds; 0 from the cache. */
  durationMs: number;
  /** Size of the response body. */
  bytes: number;
  /** 1 for the first try, then 2, 3... for retries. */
  attempt: number;
  /** Queries in a multiquery, 1 otherwise. */
  blocks: number;
  /** True when the response came from the client's cache, with no request to IGDB. */
  cached: boolean;
}

export interface TransportHooks {
  /**
   * A request ended, with a response or an error, or a response came from the cache: for logs and
   * metrics. Called once per try, so a retried request reports each one. An error thrown here is
   * ignored.
   */
  onRequest?: (info: RequestLog) => void;
  /** A request is about to be retried after a 429, a 5xx or a network error. */
  onRetry?: (info: { path: string; attempt: number; delayMs: number; reason: unknown }) => void;
  /** IGDB answered 429. */
  onRateLimited?: (info: { path: string }) => void;
}

/** @internal Calls `hooks.onRequest`, ignoring what it throws: a log must not fail a request. */
export function reportRequest(hooks: TransportHooks | undefined, info: RequestLog): void {
  try {
    hooks?.onRequest?.(info);
  } catch {
    // ignored
  }
}

/** @internal Queries in a request body: one per line of a multiquery. */
export function blocksOf(path: string, body: string | undefined): number {
  return path === "multiquery" && body
    ? body.split("\n").filter((line) => line.startsWith("query ")).length
    : 1;
}

export interface TransportOptions {
  /** Absent when requests go through your own proxy, which adds the credentials. */
  clientId?: string | undefined;
  tokens?: TokenProvider | undefined;
  limiter: Limiter;
  fetch?: typeof fetch | undefined;
  baseUrl?: string | undefined;
  /** Total time budget for retries of one request. Default 30 s. */
  retryTimeoutMs?: number | undefined;
  /** Timeout of a single HTTP attempt. Default 30 s (IGDB itself gives up after ~27 s). */
  attemptTimeoutMs?: number | undefined;
  hooks?: TransportHooks | undefined;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Sends one POST to IGDB through the limiter, with auth renewal on 401 and retries on 429, 5xx and
 * network errors until the retry budget runs out. Every IGDB request is a read, so retries are safe.
 */
export class Transport {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: TransportOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? "https://api.igdb.com/v4").replace(/\/$/, "");
  }

  /** Sends an Apicalypse query. */
  send(path: string, body: string, options: ExecuteOptions = {}): Promise<RawResponse> {
    return this.request("POST", path, { body, contentType: "text/plain" }, options);
  }

  /** Sends any IGDB request (the webhooks API uses GET, DELETE and form bodies). */
  async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    { body, contentType }: { body?: string | undefined; contentType?: string | undefined },
    options: ExecuteOptions = {},
  ): Promise<RawResponse> {
    const { signal, priority } = options;
    const deadline = Date.now() + (this.options.retryTimeoutMs ?? 30_000);
    let renewedToken = false;

    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const release = await this.options.limiter.acquire({ signal, priority });
      const started = Date.now();
      const report = (status: number, bytes: number) =>
        reportRequest(this.options.hooks, {
          path,
          method,
          status,
          durationMs: Date.now() - started,
          bytes,
          attempt: attempt + 1,
          blocks: blocksOf(path, body),
          cached: false,
        });
      let status: number;
      let text: string;
      let bytes: number;
      let headers: Headers;
      let token: string | undefined;
      try {
        token = await this.options.tokens?.getToken(signal);
        const attemptSignal = AbortSignal.timeout(this.options.attemptTimeoutMs ?? 30_000);
        const res = await this.fetchFn(`${this.baseUrl}/${path}`, {
          method,
          headers: {
            ...(this.options.clientId ? { "Client-ID": this.options.clientId } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: "application/json",
            ...(contentType ? { "Content-Type": contentType } : {}),
          },
          ...(body === undefined ? {} : { body }),
          signal: signal ? AbortSignal.any([signal, attemptSignal]) : attemptSignal,
        });
        status = res.status;
        headers = res.headers;
        // Bytes, not characters: IGDB caps responses at 10 MB, and page sizes are learned from these.
        const buffer = await res.arrayBuffer();
        bytes = buffer.byteLength;
        text = new TextDecoder().decode(buffer);
      } catch (error) {
        release();
        if (!(error instanceof IGDBError)) report(0, 0);
        if (signal?.aborted) throw signal.reason;
        if (error instanceof IGDBError) throw error; // from the token provider
        if (!(await this.backoff(path, attempt, deadline, error, signal))) {
          throw new NetworkError(`Request to ${path} failed: ${errorMessage(error)}`, {
            cause: error,
            endpoint: path,
            query: body,
          });
        }
        continue;
      }
      release();
      report(status, bytes);

      if (status >= 200 && status < 300) {
        const count = headers.get("x-count");
        return {
          data: parseBody(text, headers, { status, endpoint: path, query: body }),
          total: count === null ? undefined : Number(count),
          bytes,
        };
      }

      const error = errorFromResponse(status, text, { endpoint: path, query: body });
      if (status === 401 && !renewedToken && token && this.options.tokens?.canRefresh) {
        renewedToken = true;
        await this.options.tokens.invalidate(token, signal);
        continue;
      }
      if (status === 429) {
        this.options.limiter.reportRateLimited();
        this.options.hooks?.onRateLimited?.({ path });
      }
      if (!RETRYABLE.has(status)) throw error;
      if (!(await this.backoff(path, attempt, deadline, error, signal))) {
        throw status === 429
          ? new RateLimitError(`Still rate limited after retrying ${path}`, {
              status,
              endpoint: path,
              query: body,
              cause: error,
            })
          : error;
      }
    }
  }

  private async backoff(
    path: string,
    attempt: number,
    deadline: number,
    reason: unknown,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    const delayMs = backoffDelay(attempt + 1, 300, 10_000) + 100;
    if (Date.now() + delayMs > deadline) return false;
    this.options.hooks?.onRetry?.({ path, attempt: attempt + 1, delayMs, reason });
    await sleep(delayMs, signal);
    return true;
  }
}

function parseBody(text: string, headers: Headers, context: IGDBErrorOptions): unknown {
  const type = headers.get("content-type");
  // Webhook tests answer in plain text.
  if (type?.startsWith("text/plain") && !/^\s*[[{]/.test(text)) return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    // Typically a proxy URL that answers with an HTML page.
    throw new IGDBError(
      `Response of ${context.endpoint} is not JSON${type ? ` (${type})` : ""}: ${text.slice(0, 100)}`,
      { ...context, cause: error },
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
