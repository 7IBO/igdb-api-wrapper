import type { ExecuteOptions } from "./query";

/**
 * A result that takes several requests, such as `findByIds()` or `popular()`. Nothing is sent before
 * it is awaited or executed, like a query, and `igdb.batch()` takes it like a query. Awaiting it
 * sends its requests once, the first time; `execute()` sends them again on each call, with the
 * options of a request (`signal`, `priority`, `batch`), which apply to each of them.
 */
export class Task<T> implements Promise<T> {
  private run: Promise<T> | undefined;

  /** @internal */
  constructor(private readonly start: (options: ExecuteOptions) => Promise<T>) {}

  get [Symbol.toStringTag](): string {
    return "Task";
  }

  /** Sends the requests and resolves with the result. Each call sends them again. */
  async execute(options: ExecuteOptions = {}): Promise<T> {
    return this.start(options);
  }

  // biome-ignore lint/suspicious/noThenProperty: tasks are awaitable like queries.
  then<A = T, B = never>(
    onfulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.run ??= this.execute();
    return this.run.then(onfulfilled, onrejected);
  }

  /** Runs the task, like `await`, and handles its error as `Promise.catch` does. */
  catch<B = never>(onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
    return this.then(undefined, onrejected);
  }

  /** Runs the task, like `await`, and calls `onfinally` once it settles, as `Promise.finally` does. */
  finally(onfinally?: (() => void) | null): Promise<T> {
    this.run ??= this.execute();
    return this.run.finally(onfinally);
  }
}
