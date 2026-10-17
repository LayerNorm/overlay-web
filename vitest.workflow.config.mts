import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { workflow } from '@workflow/vitest'
export default defineConfig({
  root: fileURLToPath(new URL('./tests/workflow-runtime', import.meta.url)),
  plugins: [workflow({ cwd: fileURLToPath(new URL('./tests/workflow-runtime', import.meta.url)), rootDir: '../../work/workflow-runtime' })],
  test: { include: ['*.workflow.test.ts'], testTimeout: 60_000 },
})
