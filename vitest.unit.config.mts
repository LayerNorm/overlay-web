import { defineConfig } from 'vitest/config'

// Vitest suites outside `convex/` (the Convex suites use vitest.config.mts
// with the edge-runtime environment). Run via scripts/ci/run-all-tests.mjs.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
  },
})
