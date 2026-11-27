import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built Electron app (`npm run build` first) against
// the configured Overlay server. Run with `npm run test:e2e`.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results/e2e'
})
