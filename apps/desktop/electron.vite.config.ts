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
    // The shared bridge is linked from the monorepo's packages/ folder; resolve its zod from this app.
    resolve: { dedupe: ['zod'] },
    build: { rollupOptions: { input: resolve('src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@overlay/desktop-bridge', 'zod'] })],
    resolve: { dedupe: ['zod'] },
    build: {
      rollupOptions: {
        input: {
          'web-shell': resolve('src/preload/index.ts')
        }
      }
    }
  }
})
