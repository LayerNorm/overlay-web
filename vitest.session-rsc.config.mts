import { defineConfig } from 'vitest/config'
import unitConfig from './vitest.unit.config.mts'

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: ['src/server/auth/session.test.ts'],
  },
})
