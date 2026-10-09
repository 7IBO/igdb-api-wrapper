import type { CacheStore } from "../cache";
import type { StoredToken, TokenStore } from "../core/auth";
import { QueueFullError } from "../core/errors";
import type { AcquireOptions, Limiter, Priority } from "../core/limiter";
import { sleep } from "../core/util";

/** Sends one raw Redis command, e.g. `["SET", "key", "value"]`. */
export type RedisCommand = (args: string[]) => Promise<unknown>;

/**
 * A Redis client: ioredis, node-redis (`redis`), Bun's `RedisClient`, or a function that sends one
 * raw command. igdb-kit only sends raw commands, so it depends on none of these packages.
 */
export type RedisLike =
  | RedisCommand
  | { call(command: string, ...args: string[]): Promise<unknown> }
  | { sendCommand(args: string[]): Promise<unknown> }
  | { send(command: string, args: string[]): Promise<unknown> };

/** Turns any supported Redis client into a raw command function. */
export function redisCommand(client: RedisLike): RedisCommand {
  if (typeof client === "function") return client;
  // ioredis also has a `sendCommand`, but it takes a Command object: check `call` first.
  if ("call" in client && typeof client.call === "function") {
    return ([command, ...args]) => client.call(command as string, ...args);
  }
  if ("sendCommand" in client && typeof client.sendCommand === "function") {
    return (args) => client.sendCommand(args);
  }
  if ("send" in client && typeof client.send === "function") {
    return ([command, ...args]) => client.send(command as string, args);
  }
  throw new TypeError("Unsupported Redis client: pass ioredis, node-redis, Bun's RedisClient or a function");
}

const DEFAULT_PREFIX = "igdb-kit";

function randomId(): string {
  return crypto.randomUUID();
}

const DELETE_IF_TOKEN = `
local value = redis.call('GET', KEYS[1])
if value and cjson.decode(value).token == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

const DELETE_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export interface RedisTokenStoreOptions {
  /** The Twitch client id: one token per app. */
  clientId: string;
  /** Key prefix. Default `igdb-kit`. */
  prefix?: string | undefined;
}

/**
 * Keeps the app access token in Redis, so every process and server shares one token instead of each
 * asking Twitch for its own (Twitch keeps only 25 active tokens per app). Includes the lock that lets
 * a single process renew it.
 */
export function redisTokenStore(client: RedisLike, options: RedisTokenStoreOptions): TokenStore {
  const send = redisCommand(client);
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const key = `${prefix}:token:${options.clientId}`;
  const lockKey = `${key}:lock`;
  return {
    async get() {
      const value = await send(["GET", key]);
      return typeof value === "string" ? (JSON.parse(value) as StoredToken) : null;
    },
    async set(token) {
      const ttl = Math.max(1, Math.floor(token.expiresAt - Date.now()));
      await send(["SET", key, JSON.stringify(token), "PX", String(ttl)]);
    },
    async delete(token) {
      await send(["EVAL", DELETE_IF_TOKEN, "1", key, token]);
    },
    async lock(ttlMs) {
      const owner = randomId();
      const result = await send(["SET", lockKey, owner, "NX", "PX", String(ttlMs)]);
      if (result !== "OK") return null;
      return async () => {
        await send(["EVAL", DELETE_IF_OWNER, "1", lockKey, owner]);
      };
    },
  };
}

export interface RedisCacheOptions {
  /** Key prefix. Default `igdb-kit`. */
  prefix?: string | undefined;
}

/** Keeps cached responses in Redis, shared by every process. Pass it as the client's `cache` option. */
export function redisCache(client: RedisLike, options: RedisCacheOptions = {}): CacheStore {
  const send = redisCommand(client);
  const prefix = `${options.prefix ?? DEFAULT_PREFIX}:cache:`;
  return {
    async get(key) {
      const value = await send(["GET", prefix + key]);
      return typeof value === "string" ? value : null;
    },
    async set(key, value, ttlMs) {
      await send(["SET", prefix + key, value, "PX", String(Math.max(1, Math.round(ttlMs)))]);
    },
  };
}

// KEYS: starts (zset), in flight (zset of lease expiries), state (hash: rate, changed, paused)
// ARGV: max rate, max concurrent, lease ms, recovery step ms, member
// Returns 0 when a slot was taken, otherwise how long to wait in ms.
const ACQUIRE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local maxRate = tonumber(ARGV[1])
local state = redis.call('HMGET', KEYS[3], 'rate', 'changed', 'paused')
local rate = tonumber(state[1]) or maxRate
local changed = tonumber(state[2]) or 0
local paused = tonumber(state[3]) or 0
if rate < maxRate and now - changed >= tonumber(ARGV[4]) then
  rate = rate + 1
  redis.call('HSET', KEYS[3], 'rate', rate, 'changed', now)
  redis.call('PEXPIRE', KEYS[3], 3600000)
end
if now < paused then return paused - now end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[2]) then return 20 end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 1000)
if redis.call('ZCARD', KEYS[1]) >= rate then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return math.max(1, tonumber(oldest[2]) + 1000 - now)
end
redis.call('ZADD', KEYS[1], now, ARGV[5])
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), ARGV[5])
redis.call('PEXPIRE', KEYS[1], 2000)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[3]) * 2)
return 0`;

// KEYS: state. ARGV: max rate, pause ms. Halves the rate at most once per pause window, since every
// process sharing the quota sees the same burst of 429s.
const RATE_LIMITED = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'rate', 'changed', 'paused')
local rate = tonumber(state[1]) or tonumber(ARGV[1])
local changed = tonumber(state[2]) or 0
local paused = tonumber(state[3]) or 0
local pause = tonumber(ARGV[2])
if now - changed >= pause then
  rate = math.max(1, math.floor(rate / 2))
  changed = now
end
redis.call('HSET', KEYS[1], 'rate', rate, 'changed', changed, 'paused', math.max(paused, now + pause))
redis.call('PEXPIRE', KEYS[1], 3600000)
return rate`;

export interface RedisLimiterOptions {
  /** The Twitch client id: IGDB counts the quota per client id. */
  clientId: string;
  /** Key prefix. Default `igdb-kit`. */
  prefix?: string | undefined;
  /** Request starts per sliding second, across all processes. IGDB allows 4. */
  requestsPerSecond?: number | undefined;
  /** Requests in flight at once, across all processes. IGDB allows 8. */
  maxConcurrent?: number | undefined;
  /** Requests waiting in this process beyond this are rejected with `QueueFullError`. Default: unbounded. */
  maxQueueSize?: number | undefined;
  /** Pause applied to every process after a 429, before jitter. Default 1000 ms. */
  rateLimitPauseMs?: number | undefined;
  /** Delay between two +1 steps when recovering the rate after a 429. Default 2000 ms. */
  recoveryStepMs?: number | undefined;
  /**
   * How long a slot counts as in flight if its process dies before releasing it. Must exceed the
   * longest request. Default 60 s.
   */
  leaseMs?: number | undefined;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: () => void;
}

/**
 * The IGDB quota (4 requests per second, 8 in flight) shared by every process through Redis, with the
 * same pause and AIMD recovery as the local limiter. Each process polls Redis for one waiter at a
 * time, interactive requests first.
 */
export class RedisLimiter implements Limiter {
  private readonly send: RedisCommand;
  private readonly keys: [string, string, string];
  private readonly maxRate: number;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly pauseMs: number;
  private readonly recoveryStepMs: number;
  private readonly leaseMs: number;
  private readonly queues: Record<Priority, Waiter[]> = { interactive: [], background: [] };
  private pumping = false;

  constructor(client: RedisLike, options: RedisLimiterOptions) {
    this.send = redisCommand(client);
    const base = `${options.prefix ?? DEFAULT_PREFIX}:limiter:${options.clientId}`;
    this.keys = [`${base}:starts`, `${base}:inflight`, `${base}:state`];
    this.maxRate = options.requestsPerSecond ?? 4;
    this.maxConcurrent = options.maxConcurrent ?? 8;
    this.maxQueueSize = options.maxQueueSize ?? Number.POSITIVE_INFINITY;
    this.pauseMs = options.rateLimitPauseMs ?? 1000;
    this.recoveryStepMs = options.recoveryStepMs ?? 2000;
    this.leaseMs = options.leaseMs ?? 60_000;
  }

  get queued(): number {
    return this.queues.interactive.length + this.queues.background.length;
  }

  acquire(options: AcquireOptions = {}): Promise<() => void> {
    const { signal, priority = "interactive" } = options;
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.queued >= this.maxQueueSize) {
      return Promise.reject(new QueueFullError(`Request queue is full (${this.maxQueueSize} waiting)`));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const queue = this.queues[priority];
          const index = queue.indexOf(waiter);
          if (index !== -1) queue.splice(index, 1);
          reject(signal?.reason);
        },
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.queues[priority].push(waiter);
      void this.pump();
    });
  }

  reportRateLimited(): void {
    const jitter = Math.floor(Math.random() * this.pauseMs);
    this.send([
      "EVAL",
      RATE_LIMITED,
      "1",
      this.keys[2],
      String(this.maxRate),
      String(this.pauseMs + jitter),
    ]).catch(() => {});
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queued > 0) {
        const member = randomId();
        let wait: number;
        try {
          wait = Number(
            await this.send([
              "EVAL",
              ACQUIRE,
              "3",
              ...this.keys,
              String(this.maxRate),
              String(this.maxConcurrent),
              String(this.leaseMs),
              String(this.recoveryStepMs),
              member,
            ]),
          );
        } catch (error) {
          // Redis is unreachable: fail the waiters rather than hang them.
          for (const waiter of this.drain()) waiter.reject(error);
          return;
        }
        if (wait > 0) {
          await sleep(Math.min(wait, 1000));
          continue;
        }
        const waiter = this.queues.interactive.shift() ?? this.queues.background.shift();
        if (!waiter) {
          // Everyone gave up while we were taking the slot: hand it back.
          this.release(member);
          continue;
        }
        waiter.signal?.removeEventListener("abort", waiter.onAbort);
        let released = false;
        waiter.resolve(() => {
          if (released) return;
          released = true;
          this.release(member);
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private release(member: string): void {
    this.send(["ZREM", this.keys[1], member]).catch(() => {});
  }

  private drain(): Waiter[] {
    const waiters = [...this.queues.interactive, ...this.queues.background];
    this.queues.interactive = [];
    this.queues.background = [];
    for (const waiter of waiters) waiter.signal?.removeEventListener("abort", waiter.onAbort);
    return waiters;
  }
}

/** The IGDB quota shared through Redis. Pass it as the client's `limiter` option. */
export function redisLimiter(client: RedisLike, options: RedisLimiterOptions): RedisLimiter {
  return new RedisLimiter(client, options);
}
