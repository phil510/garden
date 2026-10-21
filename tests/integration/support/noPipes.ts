import type { Pipes } from '../../../packages/server/src/app/pipes.js';

/** For servers under test that never receive a pipe connection. */
export const noPipes: Pipes = {
  connect: () => ({ ack: () => undefined, close: () => undefined }),
  sweep: () => undefined,
  replay: () => undefined,
};
