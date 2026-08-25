import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.convex.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
