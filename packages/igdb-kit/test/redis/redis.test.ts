import { afterAll, describe, expect, test } from "bun:test";
import IORedis from "ioredis";
import { createClient } from "redis";
import { type RedisLike, redisCache, redisCommand, redisLimiter, redisTokenStore } from "../../src/redis";
import { mockFetch } from "../unit/helpers";

// Runs against a real Redis when REDIS_URL is set, e.g. redis://localhost:6379.
const url = process.env.REDIS_URL;
const suite = url ? describe : describe.skip;

const ioredis = url ? new IORedis(url) : null;
const nodeRedis = url ? createClient({ url }) : null;
const bunRedis = url ? new Bun.RedisClient(url) : null;
if (nodeRedis) await nodeRedis.connect();

afterAll(async () => {
  ioredis?.disconnect();
  await nodeRedis?.quit();
  bunRedis?.close();
});

const clients: [string, () => RedisLike][] = [
  ["ioredis", () => ioredis as IORedis],
  ["node-redis", () => nodeRedis as unknown as RedisLike],
  ["Bun", () => bunRedis as Bun.RedisClient],
];

suite.each(clients)("with %s", (name, client) => {
  const prefix = `igdb-kit-test:${name}:${crypto.randomUUID()}`;

  test("token store: set, get, delete only the current token, lock", async () => {
    const store = redisTokenStore(client(), { clientId: "app", prefix });
    expect(await store.get()).toBeNull();
    await store.set({ token: "t1", expiresAt: Date.now() + 60_000 });
    expect(await store.get()).toEqual({ token: "t1", expiresAt: expect.any(Number) });
    await store.delete("other");
    expect((await store.get())?.token).toBe("t1");
    await store.delete("t1");
    expect(await store.get()).toBeNull();

    const release = await store.lock?.(5_000);
    expect(release).toBeFunction();
    expect(await store.lock?.(5_000)).toBeNull();
    await release?.();
    const again = await store.lock?.(5_000);
    expect(again).toBeFunction();
    await again?.();
  });

  test("cache: set with TTL and get", async () => {
    const cache = redisCache(client(), { prefix });
    expect(await cache.get("k")).toBeNull();
    await cache.set("k", '{"data":[1]}', 60_000);
    expect(await cache.get("k")).toBe('{"data":[1]}');
    await cache.set("short", "x", 1);
    await Bun.sleep(20);
    expect(await cache.get("short")).toBeNull();
  });

  test("limiter: caps starts per second across instances", async () => {
    const options = { clientId: "app", prefix, requestsPerSecond: 4, maxConcurrent: 8 };
    const a = redisLimiter(client(), options);
    const b = redisLimiter(client(), options);
    const started: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const release = await (i % 2 ? a : b).acquire();
        started.push(Date.now() - t0);
        release();
      }),
    );
    started.sort((x, y) => x - y);
    // 10 starts at 4 per second: the 5th waits ~1 s and the 9th ~2 s.
    expect(started[3] as number).toBeLessThan(500);
    expect(started[4] as number).toBeGreaterThanOrEqual(900);
    expect(started[8] as number).toBeGreaterThanOrEqual(1900);
  });

  test("limiter: caps requests in flight and frees slots on release", async () => {
    const limiter = redisLimiter(client(), {
      clientId: "app",
      prefix: `${prefix}:conc`,
      requestsPerSecond: 100,
      maxConcurrent: 2,
    });
    const first = await limiter.acquire();
    await limiter.acquire();
    let third = false;
    const pending = limiter.acquire().then((release) => {
      third = true;
      return release;
    });
    await Bun.sleep(100);
    expect(third).toBeFalse();
    first();
    (await pending)();
    expect(third).toBeTrue();
  });

  test("limiter: a 429 pauses every instance and halves the rate", async () => {
    const options = { clientId: "app", prefix: `${prefix}:429`, rateLimitPauseMs: 300 };
    const a = redisLimiter(client(), options);
    const b = redisLimiter(client(), options);
    a.reportRateLimited();
    await Bun.sleep(20);
    const t0 = Date.now();
    (await b.acquire())();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    const send = redisCommand(client());
    expect(Number(await send(["HGET", `${prefix}:429:limiter:app:state`, "rate"]))).toBe(2);
  });

  test("limiter: aborting a waiter rejects it", async () => {
    const limiter = redisLimiter(client(), {
      clientId: "app",
      prefix: `${prefix}:abort`,
      maxConcurrent: 1,
    });
    const held = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire({ signal: controller.signal });
    controller.abort(new Error("stop"));
    await expect(waiting).rejects.toThrow("stop");
    held();
  });
});

suite("client wiring", () => {
  test("a client using the Redis token store, limiter and cache", async () => {
    const { createIGDB } = await import("../../src");
    const prefix = `igdb-kit-test:client:${crypto.randomUUID()}`;
    const mock = mockFetch(() => Response.json([{ id: 1 }]));
    const redis = bunRedis as Bun.RedisClient;
    const make = () =>
      createIGDB({
        clientId: "app",
        clientSecret: "secret",
        fetch: mock.fetch,
        tokenStore: redisTokenStore(redis, { clientId: "app", prefix }),
        limiter: redisLimiter(redis, { clientId: "app", prefix }),
        cache: redisCache(redis, { prefix }),
      });
    const [one, two] = [make(), make()];
    await one.games.limit(1).cache(60_000);
    await two.games.limit(1).cache(60_000);
    expect(mock.calls).toHaveLength(1); // second client hit the shared cache
    await two.games.limit(2);
    expect(mock.tokenFetches).toBe(1); // both clients share one token
  });
});
