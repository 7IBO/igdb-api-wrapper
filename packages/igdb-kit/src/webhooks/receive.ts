import { IGDBError } from "../core/errors";
import { readBodyCapped } from "../core/util";
import { type EndpointName, type Endpoints, endpoints } from "../generated/schema";
import type { SelectResult } from "../query/types";

/** What IGDB sends for a created or updated entity: every field, relations as ids. */
export type WebhookEntity<N extends EndpointName> = SelectResult<Endpoints[N], "*">;

/** One delivery received from IGDB, typed by endpoint and operation. */
export type WebhookEvent<N extends EndpointName = EndpointName> = {
  [K in N]:
    | { endpoint: K; operation: "create" | "update"; data: WebhookEntity<K> }
    | { endpoint: K; operation: "delete"; data: { id: number } };
}[N];

/** Thrown by `parseWebhook` for a delivery that is not from IGDB or cannot be read. */
export class WebhookError extends IGDBError {
  override name = "WebhookError";
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Compares secrets in constant time. */
function sameSecret(received: string | undefined, expected: string): boolean {
  if (received === undefined) return false;
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] as number);
  return diff === 0;
}

export interface WebhookDelivery {
  /** Request headers: a `Headers` object or Node's `req.headers`. */
  headers: HeaderSource;
  /** The raw body, or the body already parsed as JSON (Express `json()`). */
  body: string | unknown;
  /** The request URL, used when IGDB does not send `X-Endpoint` / `X-Operation`. */
  url?: string | undefined;
}

function checkSecret(headers: HeaderSource, secret: string): void {
  if (!sameSecret(header(headers, "x-secret"), secret)) {
    throw new WebhookError("Invalid webhook secret", { status: 401 });
  }
}

/**
 * Checks that a delivery comes from IGDB (its `X-Secret` header) and returns it typed by endpoint
 * and operation. For frameworks without fetch-style requests (Express, Fastify); otherwise use
 * `webhookHandler`.
 */
export function parseWebhook(delivery: WebhookDelivery, secret: string): WebhookEvent {
  checkSecret(delivery.headers, secret);
  const query = delivery.url ? new URL(delivery.url, "http://localhost").searchParams : undefined;
  const endpoint = normalizeEndpoint(header(delivery.headers, "x-endpoint") ?? query?.get("endpoint") ?? "");
  const operation = (header(delivery.headers, "x-operation") ?? query?.get("operation") ?? "").toLowerCase();
  if (!(endpoint in endpoints))
    throw new WebhookError(`Unknown webhook endpoint "${endpoint}"`, { status: 400 });
  if (operation !== "create" && operation !== "update" && operation !== "delete") {
    throw new WebhookError(`Unknown webhook operation "${operation}"`, { status: 400 });
  }
  let data: unknown;
  try {
    data = typeof delivery.body === "string" ? JSON.parse(delivery.body) : delivery.body;
  } catch {
    throw new WebhookError("Webhook body is not JSON", { status: 400 });
  }
  if (!data || typeof data !== "object" || typeof (data as { id?: unknown }).id !== "number") {
    throw new WebhookError("Webhook body has no entity id", { status: 400 });
  }
  return { endpoint, operation, data } as WebhookEvent;
}

function normalizeEndpoint(value: string): string {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/^v4\//, "");
}

export interface WebhookHandlerOptions<N extends EndpointName> {
  secret: string;
  /** Called for each verified delivery. IGDB retries when this throws (the handler answers 500). */
  onEvent: (event: WebhookEvent<N>) => void | Promise<void>;
  /**
   * Largest delivery body read, in bytes; a larger one is answered 413. Default 1 MB (an entity
   * weighs a few KB).
   */
  maxBodyBytes?: number | undefined;
}

/**
 * A fetch-style handler for IGDB deliveries: `(request: Request) => Promise<Response>`. Plug it into
 * `Bun.serve`, Hono (`c.req.raw`), Next.js route handlers, Deno or Cloudflare Workers. Answers 401 on
 * a wrong secret, before reading the body; 413 on a body above `maxBodyBytes`; 400 on an unreadable
 * delivery; 200 once `onEvent` resolves.
 */
export function webhookHandler<N extends EndpointName = EndpointName>(
  options: WebhookHandlerOptions<N>,
): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  return async (request) => {
    let event: WebhookEvent;
    try {
      checkSecret(request.headers, options.secret);
      const body = await readBodyCapped(request, maxBodyBytes);
      if (body === undefined) {
        return new Response(`Webhook body larger than ${maxBodyBytes} bytes`, { status: 413 });
      }
      event = parseWebhook({ headers: request.headers, body, url: request.url }, options.secret);
    } catch (error) {
      const status = error instanceof WebhookError ? (error.status ?? 400) : 400;
      return new Response(error instanceof Error ? error.message : "Bad request", { status });
    }
    try {
      await options.onEvent(event as WebhookEvent<N>);
    } catch {
      return new Response("Handler failed", { status: 500 });
    }
    return new Response("OK", { status: 200 });
  };
}
