import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirror tsconfig `@/*` → `src/*` (Convex's bundler reads tsconfig paths;
    // vitest does not). A regex keeps `@overlay/*` packages untouched.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }],
  },
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.convex.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
})
