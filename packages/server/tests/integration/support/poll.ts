/**
 * Polls `probe` until `predicate` holds or the deadline passes. tmux state changes
 * are not synchronous with the command that caused them, and a fixed sleep is
 * either flaky or slow — this fails with the last observation instead.
 */
export async function until<T>(
  description: string,
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await probe();
  while (!predicate(last)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${description}. Last observation: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    last = await probe();
  }
  return last;
}
