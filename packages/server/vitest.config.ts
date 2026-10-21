import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Colocated unit tests only. The repo-level integration tier runs
    // under the root vitest.integration.config.ts.
    include: ['src/**/*.test.ts'],
  },
});
