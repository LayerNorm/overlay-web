import { defineConfig } from 'vitest/config'
import { workflow } from '@workflow/vitest'

export default defineConfig({
  plugins: [workflow()],
  test: {
    include: ['*.smoke.test.ts'],
    testTimeout: 1_200_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
