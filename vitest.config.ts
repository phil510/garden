import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Colocated unit tests for the root scripts/ tier, plus repo-level tests for scripts that
    // don't belong to any package — see tests/plugin/ and docs/testing.md.
    include: ['scripts/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
