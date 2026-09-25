import { createLogger, guardStderr } from './logger.js';

/**
 * Spawned by logger.epipe.test.ts with its stderr end destroyed right after spawn, so these
 * writes hit a closed pipe. The two `await`s between calls are load-bearing: two `console.*`
 * calls back-to-back with no tick in between exit clean even with the read end closed, because
 * Node buffers the first write and the process exits before the async EPIPE from the second
 * would surface. Does not call redirectToFile — the writes must still go through the console
 * sink for this to exercise guardStderr rather than the file sink.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  guardStderr();
  const logger = createLogger();
  logger.warn('warn1');
  await sleep(20);
  logger.error('warn2');
  await sleep(20);
  process.exit(0);
}

void main();
