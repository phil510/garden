import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Colocated unit tests for the root scripts/ tier only.
    include: ['scripts/**/*.test.ts'],
  },
});
