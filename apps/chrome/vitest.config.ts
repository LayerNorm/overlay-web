import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: [
      {
        find: /^@overlay\/chat-react$/,
        replacement: path.resolve(__dirname, '../../packages/overlay-chat-react/src/index.ts'),
      },
      {
        find: /^@overlay\/chat-react\/styles\.css$/,
        replacement: path.resolve(__dirname, '../../packages/overlay-chat-react/src/styles/overlay-theme.css'),
      },
      {
        find: /^@overlay\/chat-core$/,
        replacement: path.resolve(__dirname, '../../packages/overlay-chat-core/src/index.ts'),
      },
      {
        find: '@overlay/extension-contracts',
        replacement: path.resolve(__dirname, 'packages/overlay-extension-contracts/src/index.ts'),
      },
    ],
  },
})
