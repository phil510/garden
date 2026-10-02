import type { RootWatches } from '../../../src/app/rootWatch.js';

/** For servers under test that never receive a `watch`. */
export const noRootWatches: RootWatches = {
  connect: () => ({ watch: () => Promise.resolve(), close: () => undefined }),
};
