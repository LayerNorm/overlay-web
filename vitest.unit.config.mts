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
      'src/server/chat/native-personal-readiness.test.ts',
      'src/server/collaboration/native-collaboration-readiness.test.ts',
      'src/features/chat/components/collaboration/NativeCollaborationProvider.test.tsx',
      'src/features/agents/lib/native-agent-threads.test.tsx',
      'src/features/chat/components/collaboration/native-room-state.test.tsx',
      'src/features/chat/components/collaboration/native-room-subscriptions.test.tsx',
      'src/features/chat/components/collaboration/native-activity.test.tsx',
      'src/server/files/computer-publication.test.ts',
      'src/server/files/computer-publication-service.test.ts',
      'src/server/files/ArtifactPublicationAuthority.test.ts',
      'src/server/storage/object-store.test.ts',
      'src/server/agents/workspace-agent-preparation.test.ts',
      'src/server/app-api/v1/conversations/act/model-candidates.test.ts',
      'src/server/app-api/v1/conversations/act/personal-harness-turn.test.ts',
      'src/server/app-api/v1/conversations/stop/route.test.ts',
      'src/server/app-api/v1/conversations/route.test.ts',
      'src/server/app-api/v1/conversations/message/send-replay.test.ts',
      'src/features/agents/components/AgentDirectoryProvider.test.tsx',
      'src/features/agents/components/ConnectedAgentSettings.test.tsx',
      'src/features/work/components/OrganizationAgentDetails.test.tsx',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
  },
})
