import type { RawResponse } from "./query/query";

/**
 * Where cached responses live. Values are JSON strings, so any key-value store fits: memory (the
 * default `memoryCache()`), Redis (`igdb-kit/redis`), a database.
 */
export interface CacheStore {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export interface MemoryCacheOptions {
  /** Entries kept at most; the least recently used go first. Default 1000. */
  maxEntries?: number | undefined;
}

/** An in-process LRU cache. */
export function memoryCache(options: MemoryCacheOptions = {}): CacheStore {
  const maxEntries = options.maxEntries ?? 1000;
  const entries = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expiresAt <= Date.now()) return undefined;
      entries.set(key, entry); // most recently used last
      return entry.value;
    },
    async set(key, value, ttlMs) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
    },
  };
}

/** Cache key of a request: a SHA-256 of its path and body, so keys stay short whatever the query. */
export async function cacheKey(path: string, body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${path}\n${body}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function serializeResponse(response: RawResponse): string {
  return JSON.stringify({ data: response.data, total: response.total });
}

export function parseResponse(value: string): RawResponse {
  return JSON.parse(value) as RawResponse;
}
