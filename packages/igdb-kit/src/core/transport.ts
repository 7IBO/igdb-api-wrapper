import type { ExecuteOptions, RawResponse } from "../query/query";
import type { TokenProvider } from "./auth";
import { errorFromResponse, IGDBError, NetworkError, RateLimitError } from "./errors";
import type { Limiter } from "./limiter";
import { backoffDelay, sleep } from "./util";

export interface TransportHooks {
  /** A request is about to be retried after a 429, a 5xx or a network error. */
  onRetry?: (info: { path: string; attempt: number; delayMs: number; reason: unknown }) => void;
  /** IGDB answered 429. */
  onRateLimited?: (info: { path: string }) => void;
}

export interface TransportOptions {
  clientId: string;
  tokens: TokenProvider;
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
      let status: number;
      let text: string;
      let headers: Headers;
      let token: string;
      try {
        token = await this.options.tokens.getToken(signal);
        const attemptSignal = AbortSignal.timeout(this.options.attemptTimeoutMs ?? 30_000);
        const res = await this.fetchFn(`${this.baseUrl}/${path}`, {
          method,
          headers: {
            "Client-ID": this.options.clientId,
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(contentType ? { "Content-Type": contentType } : {}),
          },
          ...(body === undefined ? {} : { body }),
          signal: signal ? AbortSignal.any([signal, attemptSignal]) : attemptSignal,
        });
        status = res.status;
        headers = res.headers;
        text = await res.text();
      } catch (error) {
        release();
        if (signal?.aborted) throw signal.reason;
        if (error instanceof IGDBError) throw error; // from the token provider
        if (!(await this.backoff(path, attempt, deadline, error, signal))) {
          throw new NetworkError(`Request to ${path} failed: ${errorMessage(error)}`, {
            cause: error,
            query: body,
          });
        }
        continue;
      }
      release();

      if (status >= 200 && status < 300) {
        const count = headers.get("x-count");
        return {
          data: parseBody(text, headers),
          total: count === null ? undefined : Number(count),
          bytes: text.length,
        };
      }

      const error = errorFromResponse(status, text, { endpoint: path, query: body });
      if (status === 401 && !renewedToken && this.options.tokens.canRefresh) {
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

function parseBody(text: string, headers: Headers): unknown {
  // Webhook tests answer in plain text.
  if (headers.get("content-type")?.startsWith("text/plain") && !/^\s*[[{]/.test(text)) return text;
  return JSON.parse(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
