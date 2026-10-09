import { describe, expect, spyOn, test } from "bun:test";
import { LocalLimiter, QueueFullError, sharedLimiter } from "../../src";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("LocalLimiter", () => {
  test("starts at most N requests per sliding second", async () => {
    const limiter = new LocalLimiter({ requestsPerSecond: 4, maxConcurrent: 100 });
    const started: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 9 }, async () => {
        const release = await limiter.acquire();
        started.push(Date.now() - t0);
        release();
      }),
    );
    started.sort((a, b) => a - b);
    expect(started.filter((t) => t < 900)).toHaveLength(4);
    expect(started.filter((t) => t < 1900)).toHaveLength(8);
    expect(started[8]).toBeGreaterThanOrEqual(1950);
  });

  test("caps requests in flight", async () => {
    const limiter = new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 2 });
    const r1 = await limiter.acquire();
    await limiter.acquire();
    let third = false;
    limiter.acquire().then(() => {
      third = true;
    });
    await tick(20);
    expect(third).toBe(false);
    expect(limiter.inFlight).toBe(2);
    r1();
    r1(); // releasing twice is a no-op
    await tick(5);
    expect(third).toBe(true);
    expect(limiter.inFlight).toBe(2);
  });

  test("interactive requests go before background ones", async () => {
    const limiter = new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1 });
    const release = await limiter.acquire();
    const order: string[] = [];
    const bg = limiter.acquire({ priority: "background" }).then((r) => {
      order.push("background");
      r();
    });
    const fg = limiter.acquire({ priority: "interactive" }).then((r) => {
      order.push("interactive");
      r();
    });
    release();
    await Promise.all([bg, fg]);
    expect(order).toEqual(["interactive", "background"]);
  });

  test("an aborted request leaves the queue without taking a slot", async () => {
    const limiter = new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1 });
    const release = await limiter.acquire();
    const controller = new AbortController();
    const pending = limiter.acquire({ signal: controller.signal });
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(limiter.queued).toBe(0);
    release();
    expect(limiter.inFlight).toBe(0);
  });

  test("rejects when the queue is full", async () => {
    const limiter = new LocalLimiter({ requestsPerSecond: 1000, maxConcurrent: 1, maxQueueSize: 1 });
    await limiter.acquire();
    limiter.acquire();
    await expect(limiter.acquire()).rejects.toBeInstanceOf(QueueFullError);
  });

  test("a 429 pauses the queue and halves the rate, which then recovers", async () => {
    let now = 0;
    const limiter = new LocalLimiter({
      requestsPerSecond: 4,
      rateLimitPauseMs: 50,
      recoveryStepMs: 100,
      now: () => now,
    });
    limiter.reportRateLimited();
    expect(limiter.currentRate).toBe(2);
    limiter.reportRateLimited();
    expect(limiter.currentRate).toBe(1);
    now = 150;
    (await limiter.acquire())();
    expect(limiter.currentRate).toBe(2);
  });

  test("clients with the same client id share one limiter", () => {
    expect(sharedLimiter("abc")).toBe(sharedLimiter("abc"));
    expect(sharedLimiter("abc")).not.toBe(sharedLimiter("def"));
  });

  test("other options for a shared limiter are ignored with one warning", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const first = sharedLimiter("ghi", { maxConcurrent: 4 });
      expect(sharedLimiter("ghi", { maxConcurrent: 4, now: () => 0 })).toBe(first);
      expect(sharedLimiter("ghi")).toBe(first);
      expect(warn).not.toHaveBeenCalled();
      expect(sharedLimiter("ghi", { maxConcurrent: 2 })).toBe(first);
      expect(sharedLimiter("ghi", { requestsPerSecond: 2 })).toBe(first);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("limiter options are ignored");
    } finally {
      warn.mockRestore();
    }
  });
});
