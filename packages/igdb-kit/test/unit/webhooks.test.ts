import { describe, expect, test } from "bun:test";
import { parseWebhook, WebhookError, webhookHandler } from "../../src/webhooks";
import { mockFetch, testClient } from "./helpers";

const raw = (id: number, url: string, sub_category: number) => ({
  id,
  url,
  category: 1,
  sub_category,
  active: true,
  number_of_retries: 0,
  api_key: "k",
  secret: "s",
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
});

describe("webhooks API", () => {
  test("register sends a form body and returns the typed webhook", async () => {
    const mock = mockFetch((call) => {
      const form = new URLSearchParams(call.body);
      return Response.json([raw(7, form.get("url") as string, form.get("method") === "create" ? 0 : 2)]);
    });
    const igdb = testClient(mock.fetch);
    const hook = await igdb.webhooks.register("games", {
      url: "https://x.test/h",
      secret: "s",
      operation: "create",
    });
    expect(hook).toMatchObject({
      id: 7,
      url: "https://x.test/h",
      operation: "create",
      active: true,
      retries: 0,
    });
    expect(hook.createdAt).toEqual(new Date(1_700_000_000_000));
    expect(mock.calls[0]?.url).toEndWith("/games/webhooks");
    expect(mock.calls[0]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(mock.calls[0]?.body).toBe("url=https%3A%2F%2Fx.test%2Fh&secret=s&method=create");
  });

  test("ensure registers each endpoint and operation with routing parameters", async () => {
    const mock = mockFetch((call) =>
      Response.json([raw(1, new URLSearchParams(call.body).get("url") as string, 2)]),
    );
    const igdb = testClient(mock.fetch);
    const hooks = await igdb.webhooks.ensure({
      url: "https://x.test/igdb?token=1",
      secret: "s",
      endpoints: ["games", "platforms"],
    });
    expect(hooks).toHaveLength(6);
    const urls = mock.calls.map((c) => new URLSearchParams(c.body).get("url"));
    expect(urls).toContain("https://x.test/igdb?token=1&endpoint=games&operation=delete");
    expect(urls).toContain("https://x.test/igdb?token=1&endpoint=platforms&operation=create");
  });

  test("list, get, delete and test", async () => {
    const mock = mockFetch((call) => {
      if (call.url.includes("/test/"))
        return new Response("Test sent", { headers: { "content-type": "text/plain" } });
      if (call.url.endsWith("/webhooks/404")) return Response.json([]);
      return Response.json([raw(3, "https://x.test", 1)]);
    });
    const igdb = testClient(mock.fetch);
    expect((await igdb.webhooks.list())[0]?.operation).toBe("delete");
    expect((await igdb.webhooks.get(3))?.id).toBe(3);
    expect(await igdb.webhooks.get(404)).toBeNull();
    await igdb.webhooks.delete(3);
    expect(await igdb.webhooks.test("games", 3, 1942)).toBe("Test sent");
    expect(mock.calls.at(-1)?.url).toEndWith("/games/webhooks/test/3?entityId=1942");
  });
});

describe("incoming deliveries", () => {
  const headers = { "x-secret": "s3cret", "x-endpoint": "games", "x-operation": "update" };

  test("parseWebhook verifies the secret and types the event", () => {
    const event = parseWebhook({ headers, body: '{"id":1942,"name":"The Witcher 3"}' }, "s3cret");
    expect(event).toEqual({
      endpoint: "games",
      operation: "update",
      data: { id: 1942, name: "The Witcher 3" },
    });
  });

  test("routing falls back to the URL parameters added by ensure()", () => {
    const event = parseWebhook(
      {
        headers: { "x-secret": "s3cret" },
        body: { id: 6 },
        url: "/igdb?endpoint=platforms&operation=delete",
      },
      "s3cret",
    );
    expect(event).toEqual({ endpoint: "platforms", operation: "delete", data: { id: 6 } });
  });

  test("rejects a wrong secret, an unknown endpoint and a bad body", () => {
    expect(() => parseWebhook({ headers: { ...headers, "x-secret": "nope" }, body: "{}" }, "s3cret")).toThrow(
      WebhookError,
    );
    expect(() =>
      parseWebhook({ headers: { ...headers, "x-endpoint": "nope" }, body: '{"id":1}' }, "s3cret"),
    ).toThrow('Unknown webhook endpoint "nope"');
    expect(() => parseWebhook({ headers, body: "not json" }, "s3cret")).toThrow("not JSON");
  });

  test("webhookHandler answers 200, 401, 400 and 500", async () => {
    const seen: unknown[] = [];
    const handler = webhookHandler({
      secret: "s3cret",
      onEvent: (event) => {
        if (event.data.id === 13) throw new Error("boom");
        seen.push(event);
      },
    });
    const post = (body: string, extra: Record<string, string> = {}) =>
      handler(
        new Request("https://x.test/igdb", { method: "POST", headers: { ...headers, ...extra }, body }),
      );
    expect((await post('{"id":1}')).status).toBe(200);
    expect((await post('{"id":1}', { "x-secret": "bad" })).status).toBe(401);
    expect((await post("[]")).status).toBe(400);
    expect((await post('{"id":13}')).status).toBe(500);
    expect(seen).toHaveLength(1);
  });
});
