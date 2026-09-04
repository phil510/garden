import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Colocated unit tests only. The integration tier lives in tests/ and runs
    // under vitest.integration.config.ts.
    include: ['src/**/*.test.ts'],
  },
});
