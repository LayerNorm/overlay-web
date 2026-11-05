import { defineConfig } from 'vitest/config'
// @ts-expect-error TS5097: Vite needs the .mts extension to load this shared config.
import unitConfig from './vitest.unit.config.mts'

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: [
      'src/features/agents/components/AgentDirectoryProvider.test.tsx',
      'src/features/work/components/OrganizationAgentDetails.test.tsx',
    ],
  },
})
