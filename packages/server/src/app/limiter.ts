/** A counting semaphore: callers hand it a thunk to run once a slot is free, so a rejection
 *  propagates to the caller exactly as if the limiter weren't there. */
export function createLimiter(maxConcurrent: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  // Hands the freed slot straight to the next waiter rather than decrementing `active` and
  // letting it re-acquire — that keeps a released slot from being claimed by an unrelated
  // acquire that raced in after this one queued.
  function release(): void {
    const next = queue.shift();
    if (next !== undefined) next();
    else active -= 1;
  }

  return async (fn) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
