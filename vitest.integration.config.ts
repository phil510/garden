import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // A real tmux server on one -L socket cannot serve two test files at once.
    fileParallelism: false,
  },
});
