import { TokenProvider, type TokenStore } from "./core/auth";
import { IGDBError } from "./core/errors";
import { type Limiter, type LocalLimiterOptions, sharedLimiter } from "./core/limiter";
import { Transport, type TransportHooks } from "./core/transport";
import { type EndpointName, endpoints } from "./generated/schema";
import {
  type ExecuteOptions,
  Query,
  type QueryRequest,
  type QueryRunner,
  type RawResponse,
} from "./query/query";

export interface IGDBClientOptions {
  /** Twitch application client id. */
  clientId: string;
  /** Twitch application secret, used to obtain and renew app access tokens. */
  clientSecret?: string | undefined;
  /** A token you manage yourself, instead of `clientSecret`. Never renewed. */
  accessToken?: string | undefined;
  /** Where to keep the token. Default: in memory. Use a shared store across processes. */
  tokenStore?: TokenStore | undefined;
  /**
   * Rate limiter. Default: one limiter per client id shared by every client in the process
   * (4 requests per second, 8 in flight). Pass options to tune it, or your own (e.g. Redis-backed).
   */
  limiter?: Limiter | LocalLimiterOptions | undefined;
  /** Total retry budget per request (429, 5xx, network). Default 30 s. */
  retryTimeoutMs?: number | undefined;
  /** Timeout of one HTTP attempt. Default 30 s. */
  attemptTimeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
  baseUrl?: string | undefined;
  hooks?: (TransportHooks & { onTokenRefresh?: (info: { expiresAt: number }) => void }) | undefined;
  /** Allow running in a browser. Your client secret would be exposed: only use behind a proxy. */
  dangerouslyAllowBrowser?: boolean | undefined;
}

export type IGDBClient = { readonly [K in EndpointName]: Query<K> } & {
  /** Sends a raw Apicalypse body to a path (`games`, `games/count`, `multiquery`). */
  raw<T = unknown>(path: string, body: string, options?: ExecuteOptions): Promise<T>;
};

export function createIGDB(options: IGDBClientOptions): IGDBClient {
  if (
    !options.dangerouslyAllowBrowser &&
    typeof (globalThis as { document?: unknown }).document !== "undefined"
  ) {
    throw new IGDBError(
      "igdb-kit runs on the server: in a browser your client secret would leak and IGDB does not allow CORS. " +
        "Set dangerouslyAllowBrowser only if requests go through your own proxy.",
    );
  }
  const tokens = new TokenProvider({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    accessToken: options.accessToken,
    store: options.tokenStore,
    fetch: options.fetch,
    onTokenRefresh: options.hooks?.onTokenRefresh,
  });
  const limiter =
    options.limiter && "acquire" in options.limiter
      ? options.limiter
      : sharedLimiter(options.clientId, options.limiter);
  const transport = new Transport({
    clientId: options.clientId,
    tokens,
    limiter,
    fetch: options.fetch,
    baseUrl: options.baseUrl,
    retryTimeoutMs: options.retryTimeoutMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    hooks: options.hooks,
  });
  const runner: QueryRunner = {
    run: (request: QueryRequest, runOptions?: ExecuteOptions): Promise<RawResponse> =>
      transport.send(request.path, request.body, runOptions),
  };

  const client: Record<string, unknown> = {
    raw: async (path: string, body: string, runOptions?: ExecuteOptions) =>
      (await transport.send(path, body, runOptions)).data,
  };
  for (const endpoint of Object.keys(endpoints) as EndpointName[]) {
    client[endpoint] = new Query(runner, endpoint);
  }
  return client as IGDBClient;
}
