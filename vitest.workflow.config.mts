import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { workflow } from '@workflow/vitest'
const workflowRoot = fileURLToPath(new URL('./tests/workflow-runtime', import.meta.url))
process.chdir(workflowRoot)
export default defineConfig({
  root: workflowRoot,
  plugins: [workflow({ cwd: workflowRoot, rootDir: '../../work/workflow-runtime' })],
  test: {
    include: ['*.workflow.test.ts'],
    setupFiles: [fileURLToPath(new URL('./tests/workflow-runtime/register-next-server.ts', import.meta.url))],
    testTimeout: 60_000,
  },
})
