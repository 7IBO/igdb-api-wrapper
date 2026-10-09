import { type Forward, forwardKey, type IGDBClient } from "../client";
import { AuthError, IGDBError, NetworkError, RateLimitError } from "../core/errors";
import { type EndpointName, endpoints } from "../generated/schema";

export interface ProxyOptions {
  /** The server-side client whose credentials, limiter, retries and cache the proxy uses. */
  igdb: IGDBClient;
  /** Endpoints the browser may query. Default: all of them. */
  endpoints?: readonly EndpointName[] | ((endpoint: EndpointName) => boolean) | undefined;
  /** Highest `limit` accepted in a query. Default 500, IGDB's own maximum. */
  maxLimit?: number | undefined;
  /** Allow multiqueries, which the client sends when it batches. Default true. */
  multiquery?: boolean | undefined;
  /** Largest request body accepted, in bytes. Default 16 KB. */
  maxBodyBytes?: number | undefined;
  /** Called for every query before it is sent. Return false to answer 403 (e.g. no session cookie). */
  authorize?: ((request: Request) => boolean | Promise<boolean>) | undefined;
  /** Origins allowed to call the proxy from another site. Default: same origin only (no CORS headers). */
  allowOrigin?: string | readonly string[] | ((origin: string) => boolean) | undefined;
  /** Keep IGDB's answers in the client's cache for this long. Default: no caching. */
  cacheTtlMs?: number | undefined;
  /** `Cache-Control` header of successful answers, e.g. `public, max-age=300`. Default: none. */
  cacheControl?: string | undefined;
}

/** Thrown inside the proxy for a request it refuses; answered with IGDB's error format. */
class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A fetch-style handler, `(request: Request) => Promise<Response>`, that lets a browser client
 * (`createIGDB({ proxyUrl })`) query IGDB without seeing your credentials. Mount it on a catch-all
 * route (`/api/igdb/*`): the last path segment names the endpoint (`games`, `games/count`, `multiquery`).
 * Only Apicalypse reads are forwarded, never the webhooks API.
 */
export function igdbProxy(options: ProxyOptions): (request: Request) => Promise<Response> {
  const forward = (options.igdb as unknown as Record<symbol, Forward | undefined>)[forwardKey];
  if (!forward) throw new IGDBError("igdbProxy needs a client made by createIGDB() with credentials");
  const allowed = endpointFilter(options.endpoints);
  const maxLimit = options.maxLimit ?? 500;
  const maxBodyBytes = options.maxBodyBytes ?? 16_384;

  return async (request) => {
    const cors = corsHeaders(request, options.allowOrigin);
    if (request.method === "OPTIONS" && cors) {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type, Accept",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    try {
      if (request.method !== "POST") throw new Refused(405, "Only POST is accepted");
      const path = pathOf(request.url);
      const body = await readBody(request, maxBodyBytes);
      if (path === "multiquery") {
        if (options.multiquery === false) throw new Refused(403, "Multiqueries are not allowed");
        for (const endpoint of multiqueryEndpoints(body)) checkEndpoint(endpoint, allowed);
      } else {
        checkEndpoint(path.replace(/\/count$/, ""), allowed);
      }
      checkLimits(body, maxLimit);
      if (options.authorize && !(await options.authorize(request))) throw new Refused(403, "Not authorized");

      const response = await forward(path, body, { cacheTtlMs: options.cacheTtlMs, signal: request.signal });
      return Response.json(response.data, {
        headers: {
          ...cors,
          ...(response.total === undefined ? {} : { "X-Count": String(response.total) }),
          ...(options.cacheControl ? { "Cache-Control": options.cacheControl } : {}),
        },
      });
    } catch (error) {
      return errorResponse(error, cors);
    }
  };
}

function endpointFilter(option: ProxyOptions["endpoints"]): (endpoint: string) => boolean {
  if (typeof option === "function") return (e) => e in endpoints && option(e as EndpointName);
  if (option) {
    const set = new Set<string>(option);
    return (e) => set.has(e);
  }
  return (e) => e in endpoints;
}

function checkEndpoint(endpoint: string, allowed: (endpoint: string) => boolean): void {
  if (!allowed(endpoint))
    throw new Refused(404, `Endpoint "${endpoint}" is not available through this proxy`);
}

/** `/api/igdb/games/count` -> `games/count`; `/api/igdb/multiquery` -> `multiquery`. */
function pathOf(url: string): string {
  const segments = new URL(url, "http://localhost").pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  if (last === "count" && segments.length >= 2) return `${segments.at(-2)}/count`;
  return last;
}

async function readBody(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) throw new Refused(400, `Query larger than ${maxBytes} bytes`);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > maxBytes)
    throw new Refused(400, `Query larger than ${maxBytes} bytes`);
  return body;
}

const STRING = /"(?:[^"\\]|\\.)*"/g;

/** Endpoints named by the blocks of a multiquery body: `query games/count "name" { ... };`. */
function multiqueryEndpoints(body: string): string[] {
  const found: string[] = [];
  const header = /\s*query\s+([\w/]+)\s+"(?:[^"\\]|\\.)*"\s*\{/y;
  let i = 0;
  while (body.slice(i).trim()) {
    header.lastIndex = i;
    const m = header.exec(body);
    if (!m) throw new Refused(400, "Malformed multiquery");
    found.push((m[1] as string).replace(/\/count$/, ""));
    i = blockEnd(body, header.lastIndex);
    const end = /\s*;?/y;
    end.lastIndex = i;
    end.exec(body);
    i = end.lastIndex;
  }
  if (found.length === 0) throw new Refused(400, "Malformed multiquery");
  return found;
}

/** Index just after the `}` closing a block that starts at `start` (after its `{`). */
function blockEnd(body: string, start: number): number {
  let depth = 1;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (c === '"') {
      for (i++; i < body.length && body[i] !== '"'; i++) if (body[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  throw new Refused(400, "Malformed multiquery");
}

/** Rejects any `limit` above the cap, ignoring text inside strings (a search term, a name). */
function checkLimits(body: string, maxLimit: number): void {
  for (const m of body.replace(STRING, '""').matchAll(/\blimit\s+(\d+)/gi)) {
    if (Number(m[1]) > maxLimit)
      throw new Refused(400, `limit ${m[1]} is above this proxy's maximum of ${maxLimit}`);
  }
}

function corsHeaders(
  request: Request,
  allow: ProxyOptions["allowOrigin"],
): Record<string, string> | undefined {
  const origin = request.headers.get("origin");
  if (!allow || !origin) return undefined;
  const ok =
    allow === "*" ||
    (typeof allow === "string"
      ? allow === origin
      : typeof allow === "function"
        ? allow(origin)
        : allow.includes(origin));
  if (!ok) return undefined;
  return {
    "Access-Control-Allow-Origin": allow === "*" ? "*" : origin,
    "Access-Control-Expose-Headers": "X-Count",
    ...(allow === "*" ? {} : { Vary: "Origin" }),
  };
}

/** Answers in IGDB's error format, so the browser client throws the same error classes. */
function errorResponse(error: unknown, cors: Record<string, string> | undefined): Response {
  const headers = { ...cors };
  if (error instanceof Refused) {
    return Response.json([{ title: "Refused by proxy", status: error.status, cause: error.message }], {
      status: error.status,
      headers,
    });
  }
  // The proxy's own credentials or connection failed: not the browser's fault, and not a 401 it could fix.
  if (error instanceof AuthError || error instanceof NetworkError || !(error instanceof IGDBError)) {
    return Response.json({ message: "The proxy could not reach IGDB" }, { status: 502, headers });
  }
  const status = error instanceof RateLimitError ? 429 : (error.status ?? 502);
  if (error.details.length > 0) return Response.json(error.details, { status, headers });
  return Response.json({ message: error.message }, { status, headers });
}
