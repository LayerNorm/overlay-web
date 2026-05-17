import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(rootDir, 'sidepanel.html'),
        background: resolve(rootDir, 'src/background/index.ts'),
        content: resolve(rootDir, 'src/content/index.ts'),
        bridge: resolve(rootDir, 'src/content/bridge.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js'
          if (chunkInfo.name === 'content') return 'content.js'
          if (chunkInfo.name === 'bridge') return 'bridge.js'
          return 'assets/[name]-[hash].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@overlay\/chat-react$/,
        replacement: resolve(rootDir, '../packages/overlay-chat-react/src/index.ts'),
      },
      {
        find: /^@overlay\/chat-react\/styles\.css$/,
        replacement: resolve(rootDir, '../packages/overlay-chat-react/src/styles/overlay-theme.css'),
      },
      {
        find: /^@overlay\/chat-core$/,
        replacement: resolve(rootDir, '../packages/overlay-chat-core/src/index.ts'),
      },
      {
        find: '@overlay/extension-contracts',
        replacement: resolve(rootDir, 'packages/overlay-extension-contracts/src/index.ts'),
      },
    ],
  },
})
