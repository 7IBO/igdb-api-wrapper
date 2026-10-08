import { describe, expect, test } from "bun:test";
import {
  AuthError,
  errorFromResponse,
  NetworkError,
  PayloadTooLargeError,
  QueryError,
  QueryTimeoutError,
  RateLimitError,
  TierError,
} from "../../src";

// Bodies copied from real IGDB responses (see the API mapping notes).
describe("errorFromResponse", () => {
  test("Apicalypse 400 keeps the details", () => {
    const e = errorFromResponse(
      400,
      '[{"title":"Invalid Field","status":400,"cause":"Invalid field name: \'nope\'"}]',
      { endpoint: "games" },
    );
    expect(e).toBeInstanceOf(QueryError);
    expect(e.message).toBe("Invalid query on games: Invalid Field: Invalid field name: 'nope'");
    expect(e.details[0]?.title).toBe("Invalid Field");
  });

  test("limit 501 is a 403 query error, not an auth error", () => {
    const e = errorFromResponse(
      403,
      '[{"title":"Request limit to high","status":403,"cause":"You typed in 501 as limit but your maximum is 500"}]',
    );
    expect(e).toBeInstanceOf(QueryError);
  });

  test("403 for an access tier", () => {
    const e = errorFromResponse(
      403,
      '[{"title":"Forbidden","status":403,"cause":"Trying to access a forbidden endpoint: This data is not available in your API tier"}]',
    );
    expect(e).toBeInstanceOf(TierError);
  });

  test("gateway errors use { message }", () => {
    expect(errorFromResponse(429, '{"message":"Too Many Requests"}')).toBeInstanceOf(RateLimitError);
    expect(errorFromResponse(401, '{"message":"Authorization Failure. Have you tried:"}')).toBeInstanceOf(
      AuthError,
    );
  });

  test("413, 408, 5xx and plain-text 404", () => {
    expect(
      errorFromResponse(
        413,
        '[{"title":"Payload Too Large","status":413,"cause":"Response exceeds 10MB limit."}]',
      ),
    ).toBeInstanceOf(PayloadTooLargeError);
    expect(errorFromResponse(408, '[{"title":"Request Timeout","status":408}]')).toBeInstanceOf(
      QueryTimeoutError,
    );
    expect(errorFromResponse(502, "Bad Gateway")).toBeInstanceOf(NetworkError);
    const notFound = errorFromResponse(404, "Endpoint POST /gamez not found");
    expect(notFound).toBeInstanceOf(QueryError);
    expect(notFound.message).toContain("/gamez");
  });
});
