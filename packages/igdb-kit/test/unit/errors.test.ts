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

  test("a 413 says whether the request body or the response is too large", () => {
    // A body of 32,001 bytes gets the server's own error, plain text without `Accept: application/json`;
    // from 40,000 bytes, one Apicalypse entry, not an array.
    const content = errorFromResponse(
      413,
      '{\n    "title": "Content Too Large",\n    "status": 413,\n    "type": "https://javalin.io/documentation#error-responses",\n    "details": {}\n}',
      { endpoint: "multiquery" },
    );
    expect(content).toBeInstanceOf(PayloadTooLargeError);
    expect(content.message).toBe("Request body too large on multiquery: Content Too Large");
    expect(content.details[0]?.title).toBe("Content Too Large");
    expect(content.details[0]).not.toHaveProperty("details");
    expect(errorFromResponse(413, "Content Too Large", { endpoint: "games" }).message).toBe(
      "Request body too large on games: Content Too Large",
    );
    const request = errorFromResponse(
      413,
      '{\n  "title": "Request Too Large",\n  "status": 413,\n  "cause": "Your request body exceeds the maximum allowed size of 32KB.",\n  "details": "Please reduce your request size or contact support via Discord (https://discord.gg/igdb)."\n}\n',
      { endpoint: "games" },
    );
    expect(request).toBeInstanceOf(PayloadTooLargeError);
    expect(request.message).toStartWith(
      "Request body too large on games: Request Too Large: Your request body exceeds the maximum allowed size of 32KB.",
    );
    expect(request.details[0]?.title).toBe("Request Too Large");
    // The response cap's details are cut in our logs after "select f".
    const response = errorFromResponse(
      413,
      '[{"title":"Payload Too Large","status":413,"cause":"Response size exceeds maximum allowed","details":"Response exceeds 10MB limit. Reduce limit or select fewer fields"}]',
      { endpoint: "games" },
    );
    expect(response).toBeInstanceOf(PayloadTooLargeError);
    expect(response.message).toStartWith(
      "Response too large on games: Payload Too Large: Response size exceeds maximum allowed",
    );
  });
});
