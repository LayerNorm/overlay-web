import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@overlay/extension-contracts': path.resolve(
        __dirname,
        'packages/overlay-extension-contracts/src/index.ts',
      ),
      '@overlay/chat-ui': path.resolve(__dirname, 'packages/overlay-chat-ui/src/index.ts'),
    },
  },
})
