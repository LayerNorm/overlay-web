import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Vitest suites outside `convex/` (the Convex suites use vitest.config.mts
// with the edge-runtime environment). Run via scripts/ci/run-all-tests.mjs.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      {
        find: /^@layernorm\/overlay-agent-bridge-protocol$/,
        replacement: fileURLToPath(new URL('./packages/overlay-agent-bridge-protocol/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'src/server/harness/**/*.test.ts',
      'src/server/agents/workspace-agent-preparation.test.ts',
      'src/server/app-api/v1/conversations/act/model-candidates.test.ts',
      'src/server/app-api/v1/conversations/act/personal-harness-turn.test.ts',
      'src/server/app-api/v1/conversations/stop/route.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
  },
})
