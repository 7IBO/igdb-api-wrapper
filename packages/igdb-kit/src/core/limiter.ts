import { QueueFullError } from "./errors";

export type Priority = "interactive" | "background";

export interface AcquireOptions {
  signal?: AbortSignal | undefined;
  priority?: Priority | undefined;
}

/** Hands out request slots. Swap in a distributed implementation to share the quota across processes. */
export interface Limiter {
  /** Resolves with a release function once a request may start. */
  acquire(options?: AcquireOptions): Promise<() => void>;
  /** Called on a 429: someone else is using the same quota, so slow down. */
  reportRateLimited(): void;
}

export interface LocalLimiterOptions {
  /** Request starts per sliding second. IGDB allows 4. */
  requestsPerSecond?: number | undefined;
  /** Requests in flight at once. IGDB allows 8. */
  maxConcurrent?: number | undefined;
  /** Waiting requests beyond this are rejected with `QueueFullError`. Default: unbounded. */
  maxQueueSize?: number | undefined;
  /** Pause applied to the whole queue after a 429, before jitter. Default 1000 ms. */
  rateLimitPauseMs?: number | undefined;
  /** Delay between two +1 steps when recovering the rate after a 429. Default 2000 ms. */
  recoveryStepMs?: number | undefined;
  now?: (() => number) | undefined;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: () => void;
}

const WINDOW_MS = 1000;

/**
 * Sliding-window limiter (N starts per second) combined with a concurrency cap. After a 429 it pauses
 * the whole queue and halves the rate, then raises it back one step at a time (AIMD): IGDB sends no
 * Retry-After header, and a 429 under our own limit means another consumer shares the client id.
 */
export class LocalLimiter implements Limiter {
  private readonly maxRate: number;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly pauseMs: number;
  private readonly recoveryStepMs: number;
  private readonly now: () => number;
  private rate: number;
  private lastRateChange = 0;
  private pausedUntil = 0;
  private active = 0;
  private starts: number[] = [];
  private readonly queues: Record<Priority, Waiter[]> = { interactive: [], background: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LocalLimiterOptions = {}) {
    this.maxRate = options.requestsPerSecond ?? 4;
    this.maxConcurrent = options.maxConcurrent ?? 8;
    this.maxQueueSize = options.maxQueueSize ?? Number.POSITIVE_INFINITY;
    this.pauseMs = options.rateLimitPauseMs ?? 1000;
    this.recoveryStepMs = options.recoveryStepMs ?? 2000;
    this.now = options.now ?? Date.now;
    this.rate = this.maxRate;
  }

  /** Current allowed rate, lowered after 429s. */
  get currentRate(): number {
    return this.rate;
  }

  get queued(): number {
    return this.queues.interactive.length + this.queues.background.length;
  }

  get inFlight(): number {
    return this.active;
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
      this.pump();
    });
  }

  reportRateLimited(): void {
    const now = this.now();
    this.pausedUntil = Math.max(this.pausedUntil, now + this.pauseMs + Math.random() * this.pauseMs);
    this.rate = Math.max(1, Math.floor(this.rate / 2));
    this.lastRateChange = now;
    this.schedule(this.pausedUntil - now);
  }

  private pump(): void {
    for (;;) {
      if (this.queued === 0) return;
      const now = this.now();
      if (this.rate < this.maxRate && now - this.lastRateChange >= this.recoveryStepMs) {
        this.rate += 1;
        this.lastRateChange = now;
      }
      if (now < this.pausedUntil) {
        this.schedule(this.pausedUntil - now);
        return;
      }
      if (this.active >= this.maxConcurrent) return; // a release will pump again
      while (this.starts.length > 0 && (this.starts[0] as number) <= now - WINDOW_MS) this.starts.shift();
      if (this.starts.length >= this.rate) {
        this.schedule((this.starts[0] as number) + WINDOW_MS - now);
        return;
      }
      const waiter = this.queues.interactive.shift() ?? this.queues.background.shift();
      if (!waiter) return;
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      this.active++;
      this.starts.push(now);
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.pump();
      });
    }
  }

  private schedule(delay: number): void {
    if (this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.pump();
      },
      Math.max(1, delay),
    );
  }
}

const registry = new Map<string, LocalLimiter>();

/**
 * The limiter shared by every client created with the same client id in this process. IGDB counts the
 * quota per client id, so two clients must not each get 4 requests per second.
 */
export function sharedLimiter(clientId: string, options?: LocalLimiterOptions): LocalLimiter {
  let limiter = registry.get(clientId);
  if (!limiter) {
    limiter = new LocalLimiter(options);
    registry.set(clientId, limiter);
  }
  return limiter;
}
