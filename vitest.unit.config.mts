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
      'src/server/automations/automation-agent-instructions.test.ts',
      'src/server/files/computer-publication.test.ts',
      'src/server/files/computer-publication-service.test.ts',
      'src/server/files/ArtifactPublicationAuthority.test.ts',
      'src/server/storage/object-store.test.ts',
      'src/app/api/bug-report/**/*.test.ts',
      'src/components/layout/AppSidebarAgentsPanel.test.tsx',
      'src/features/settings/components/ArchivedSettings.test.tsx',
      'src/components/layout/sidebar/HelpMenu.test.tsx',
      'src/contexts/WorkspaceContext.test.tsx',
      'src/hooks/use-panel-scope.test.tsx',
      'src/server/agents/workspace-agent-preparation.test.ts',
      'src/server/app-api/v1/conversations/act/model-candidates.test.ts',
      'src/server/app-api/v1/conversations/act/personal-harness-turn.test.ts',
      'src/shared/chat/public-stream-projection.test.ts',
      'src/server/app-api/v1/conversations/stop/route.test.ts',
      'src/server/app-api/v1/conversations/route.test.ts',
      'src/server/billing/provider-budget-check.test.ts',
      'src/server/app-api/v1/transcribe/route.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
  },
})
