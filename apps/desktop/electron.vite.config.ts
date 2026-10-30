import { resolve } from 'node:path'
import { cpSync, mkdirSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
export default defineConfig({
  main: {
    define: { 'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? '') },
    plugins: [
      externalizeDepsPlugin({ exclude: ['@overlay/desktop-bridge'] }),
      {
        name: 'native-pages',
        closeBundle() {
          mkdirSync('out/renderer', { recursive: true })
          cpSync('src/native', 'out/renderer', { recursive: true })
        }
      }
    ],
    build: { rollupOptions: { input: resolve('src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@overlay/desktop-bridge', 'zod'] })],
    build: {
      rollupOptions: {
        input: {
          'web-shell': resolve('src/preload/index.ts')
        }
      }
    }
  }
})
