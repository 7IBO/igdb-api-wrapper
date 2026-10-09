/** One entry of the error array IGDB returns for Apicalypse errors (400, 403, 413). */
export interface ApicalypseErrorDetail {
  title: string;
  status: number;
  cause?: string;
  details?: string;
}

export interface IGDBErrorOptions {
  status?: number | undefined;
  details?: ApicalypseErrorDetail[] | undefined;
  /** The Apicalypse body of the failing request, when there is one. */
  query?: string | undefined;
  endpoint?: string | undefined;
  cause?: unknown;
}

/** Base class of every error thrown by igdb-kit. */
export class IGDBError extends Error {
  override name = "IGDBError";
  readonly status: number | undefined;
  readonly details: ApicalypseErrorDetail[];
  readonly query: string | undefined;
  readonly endpoint: string | undefined;

  constructor(message: string, options: IGDBErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.status = options.status;
    this.details = options.details ?? [];
    this.query = options.query;
    this.endpoint = options.endpoint;
  }
}

/** The query was rejected: invalid field, syntax error, `limit` above 500, too many multiquery blocks. */
export class QueryError extends IGDBError {
  override name = "QueryError";
}

/**
 * `firstOrThrow()` / `findByIdOrThrow()` found nothing, or a name passed to `developedBy()` /
 * `publishedBy()` matches no company.
 */
export class NotFoundError extends IGDBError {
  override name = "NotFoundError";
  /** For a company name that matches no company: the companies that contain it, most games first. */
  readonly suggestions: readonly string[];

  constructor(
    message: string,
    options: IGDBErrorOptions & { suggestions?: readonly string[] | undefined } = {},
  ) {
    super(message, options);
    this.suggestions = options.suggestions ?? [];
  }
}

/**
 * IGDB refused a size (413): the response would exceed its 10 MB cap (lower `limit` or select fewer
 * fields), or the request body exceeds 32,000 bytes (send fewer ids). The message says which.
 */
export class PayloadTooLargeError extends IGDBError {
  override name = "PayloadTooLargeError";
}

/** Credentials are invalid or revoked, or the token was still refused after one renewal. */
export class AuthError extends IGDBError {
  override name = "AuthError";
}

/** Still rate limited (429) when the retry budget ran out. */
export class RateLimitError extends IGDBError {
  override name = "RateLimitError";
}

/** The data exists but your API access tier does not include it (403, e.g. `content_safety_*`). */
export class TierError extends IGDBError {
  override name = "TierError";
}

/** IGDB gave up on the query after ~27 s (408), typically a `where` on a deeply expanded field. */
export class QueryTimeoutError extends IGDBError {
  override name = "QueryTimeoutError";
}

/** A 5xx or network failure that persisted until the retry budget ran out. */
export class NetworkError extends IGDBError {
  override name = "NetworkError";
}

/** The request queue is full (`maxQueueSize`). */
export class QueueFullError extends IGDBError {
  override name = "QueueFullError";
}

/**
 * IGDB's 413 for a request body over 32,000 bytes ("Content Too Large", then "Request Too Large"
 * further up), as opposed to "Payload Too Large: Response size exceeds…" for a response over 10 MB.
 */
const REQUEST_TOO_LARGE = /request too large|content too large|entity too large|request body/i;

/** An error entry with a `title`. The server's own errors (Javalin) have an object as `details`: dropped. */
function toDetail(entry: unknown): ApicalypseErrorDetail[] {
  if (typeof entry !== "object" || entry === null) return [];
  const detail: Record<string, unknown> = { ...entry };
  if (typeof detail.title !== "string") return [];
  for (const key of ["cause", "details"]) if (typeof detail[key] !== "string") delete detail[key];
  return [detail as unknown as ApicalypseErrorDetail];
}

/**
 * Turns an IGDB error response into a typed error. IGDB uses two shapes: an array of
 * `{ title, status, cause }` for Apicalypse errors, and `{ message }` from the API gateway (401, 429).
 * The status alone is not enough: a `limit` above 500 is a 403 that has nothing to do with auth.
 */
export function errorFromResponse(
  status: number,
  bodyText: string,
  context: { endpoint?: string | undefined; query?: string | undefined } = {},
): IGDBError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = undefined;
  }
  // An array for Apicalypse errors; a single entry for a request body over the limit.
  const details = (Array.isArray(parsed) ? parsed : [parsed]).flatMap(toDetail);
  const gatewayMessage =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) && "message" in parsed
      ? String((parsed as { message: unknown }).message)
      : undefined;

  const detailText = details.map((d) => [d.title, d.cause, d.details].filter(Boolean).join(": ")).join("; ");
  const text = detailText || gatewayMessage || bodyText.slice(0, 300) || `HTTP ${status}`;
  const where = context.endpoint ? ` on ${context.endpoint}` : "";
  const options: IGDBErrorOptions = { status, details, ...context };

  if (status === 413) {
    const subject = REQUEST_TOO_LARGE.test(text) && !/response/i.test(text) ? "Request body" : "Response";
    return new PayloadTooLargeError(`${subject} too large${where}: ${text}`, options);
  }
  if (status === 429) return new RateLimitError(`Rate limited${where}: ${text}`, options);
  if (status === 401) return new AuthError(`Authentication failed${where}: ${text}`, options);
  if (status === 403 && /tier/i.test(text))
    return new TierError(`Not available in your API tier${where}: ${text}`, options);
  if (status === 408) return new QueryTimeoutError(`IGDB timed out${where}: ${text}`, options);
  if (details.length > 0) return new QueryError(`Invalid query${where}: ${text}`, options);
  if (status === 403) return new AuthError(`Forbidden${where}: ${text}`, options);
  if (status >= 500) return new NetworkError(`IGDB server error ${status}${where}: ${text}`, options);
  return new QueryError(`Request failed with ${status}${where}: ${text}`, options);
}
