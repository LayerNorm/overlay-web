import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Vitest suites outside `convex/` (the Convex suites use vitest.config.mts
// with the edge-runtime environment). Run via scripts/ci/run-all-tests.mjs.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }],
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'src/server/harness/**/*.test.ts',
      'src/server/app-api/v1/conversations/act/model-candidates.test.ts',
      'src/server/app-api/v1/conversations/act/personal-harness-turn.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
  },
})
