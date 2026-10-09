import type { ExecuteOptions } from "./query";

/**
 * A result that takes several requests, such as a view's games and their linked rows. Nothing is
 * sent before it is awaited or executed, like a query; `execute()` takes the options of a request
 * (`signal`, `priority`, `batch`), which apply to each of them.
 */
export class Task<T> implements PromiseLike<T> {
  /** @internal */
  constructor(private readonly start: (options: ExecuteOptions) => Promise<T>) {}

  /** Sends the requests and resolves with the result. Each call sends them again. */
  execute(options: ExecuteOptions = {}): Promise<T> {
    return this.start(options);
  }

  // biome-ignore lint/suspicious/noThenProperty: tasks are awaitable like queries.
  then<A = T, B = never>(
    onfulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  /** Runs the task, like `await`, and handles its error as `Promise.catch` does. */
  catch<B = never>(onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
    return this.execute().catch(onrejected);
  }

  /** Runs the task, like `await`, and calls `onfinally` once it settles, as `Promise.finally` does. */
  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.execute().finally(onfinally);
  }
}
