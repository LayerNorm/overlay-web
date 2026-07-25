import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), [
    'VITE_',
    'WORKOS_',
    'DEV_WORKOS_',
    'AUTH_',
    'SENTRY_',
    'CONVEX_',
    'DEV_NEXT_PUBLIC_',
    'NEXT_PUBLIC_CONVEX_',
    'APP_'
  ])
  const isDev = mode === 'development'
  const appServerUrl =
    process.env.APP_SERVER_URL ||
    env.APP_SERVER_URL ||
    (isDev ? process.env.DEV_NEXT_PUBLIC_APP_URL || env.DEV_NEXT_PUBLIC_APP_URL || '' : '') ||
    ''
  // When APP_SERVER_URL points to production, use prod WorkOS client even in dev mode
  const isUsingProdServer = Boolean(appServerUrl && !appServerUrl.includes('localhost'))
  const isDev_workos = isDev && !isUsingProdServer

  // Merge process.env values (for CI) with loadEnv values (for local .env files)
  // process.env takes precedence for CI builds
  const workosClientId = process.env.WORKOS_CLIENT_ID || env.WORKOS_CLIENT_ID || ''
  const devWorkosClientId = process.env.DEV_WORKOS_CLIENT_ID || env.DEV_WORKOS_CLIENT_ID || ''
  const workosRedirectUri =
    process.env.WORKOS_REDIRECT_URI || env.WORKOS_REDIRECT_URI || 'overlay://auth/callback'
  const authStorageKey =
    process.env.AUTH_STORAGE_KEY || env.AUTH_STORAGE_KEY || 'overlay-auth-session'
  const sentryDsn = process.env.SENTRY_DSN || env.SENTRY_DSN || ''

  // Convex URL - use dev URL in dev mode if available
  const convexUrl = isDev_workos
    ? process.env.DEV_NEXT_PUBLIC_CONVEX_URL ||
      env.DEV_NEXT_PUBLIC_CONVEX_URL ||
      process.env.NEXT_PUBLIC_CONVEX_URL ||
      env.NEXT_PUBLIC_CONVEX_URL ||
      ''
    : process.env.NEXT_PUBLIC_CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL || ''

  // Vite plugin: resolve bare imports from overlay-desktop/node_modules when
  // they can't be found from the shared @overlay/* package directories.
  // The shared packages (packages/overlay-*) import third-party deps that are
  // only installed in overlay-desktop/node_modules, not in the monorepo root.
  const localResolvePlugin: Plugin = {
    name: 'local-resolve',
    enforce: 'pre' as const,
    async resolveId(source: string, importer: string | undefined) {
      if (!source || source.startsWith('.') || source.startsWith('/')) return null
      if (source.startsWith('@overlay') || source.startsWith('@renderer')) return null
      if (source.startsWith('node:')) return null
      if (!importer) return null
      // Only intercept when the importer is outside overlay-desktop's own src/
      const desktopSrc = resolve('src')
      const desktopNodeModules = resolve('node_modules')
      if (importer.startsWith(desktopSrc) || importer.startsWith(desktopNodeModules)) return null
      // Resolve as an ESM import from inside overlay-desktop. Using
      // createRequire.resolve here selects CommonJS export conditions for
      // packages such as TipTap. Mixing that CJS entry with the ESM entry in
      // the same renderer bundle turns default imports into namespace objects
      // and crashes at startup (for example, CodeBlock.extend is undefined).
      return this.resolve(source, resolve('src/renderer/src/shared-dependency-resolver.ts'), {
        skipSelf: true
      })
    }
  }

  return {
    main: {
      // Bundle @overlay/* workspace packages into the main process instead of
      // externalizing them. These are TypeScript source packages (no dist
      // output) with extensionless internal imports that Node ESM cannot
      // resolve at runtime if externalized.
      resolve: {
        alias: {
          '@overlay/app-core/file-viewer': resolve(
            'packages/overlay-app-core/src/file-viewer.ts'
          ),
          '@overlay/app-core/file-parity-fixtures': resolve(
            'packages/overlay-app-core/src/file-parity-fixtures.ts'
          ),
          '@overlay/app-core/automations': resolve(
            'packages/overlay-app-core/src/automations.ts'
          ),
          '@overlay/app-core/extensions': resolve(
            'packages/overlay-app-core/src/extensions.ts'
          ),
          '@overlay/app-core/modules': resolve('packages/overlay-app-core/src/modules.ts'),
          '@overlay/app-core/settings-account': resolve(
            'packages/overlay-app-core/src/settings-account.ts'
          ),
          '@overlay/app-core/theme': resolve('packages/overlay-app-core/src/theme.ts'),
          '@overlay/app-core/contracts': resolve(
            'packages/overlay-app-core/src/contracts.ts'
          ),
          '@overlay/chat-core/agent-assistant-text': resolve(
            'packages/overlay-chat-core/src/agent-assistant-text.ts'
          ),
          '@overlay/chat-core/generated-ui': resolve(
            'packages/overlay-chat-core/src/generated-ui.ts'
          ),
          '@overlay/chat-core/markdown-table-fix': resolve(
            'packages/overlay-chat-core/src/markdown-table-fix.ts'
          ),
          '@overlay/chat-core/parity-fixtures': resolve(
            'packages/overlay-chat-core/src/parity-fixtures.ts'
          ),
          '@overlay/chat-core/shim-incomplete-markdown': resolve(
            'packages/overlay-chat-core/src/shim-incomplete-markdown.ts'
          ),
          '@overlay/api-client': resolve('packages/overlay-api-client/src/index.ts'),
          '@overlay/app-core': resolve('packages/overlay-app-core/src/index.ts'),
          '@overlay/auth-contracts': resolve('packages/overlay-auth-contracts/src/index.ts'),
          '@overlay/billing': resolve('packages/overlay-billing/src/index.ts'),
          '@overlay/chat-core': resolve('packages/overlay-chat-core/src/index.ts'),
          '@overlay/chat-react': resolve('packages/overlay-chat-react/src/index.ts'),
          '@overlay/llm-gateway': resolve('packages/overlay-llm-gateway/src/index.ts'),
          '@overlay/modules-react': resolve('packages/overlay-modules-react/src/index.ts'),
          '@overlay/tools-core': resolve('packages/overlay-tools-core/src/index.ts'),
          '@overlay/ui': resolve('packages/overlay-ui/src/index.ts')
        }
      },
      plugins: [
        externalizeDepsPlugin({
          exclude: [
            '@overlay/api-client',
            '@overlay/app-core',
            '@overlay/auth-contracts',
            '@overlay/billing',
            '@overlay/chat-core',
            '@overlay/chat-react',
            '@overlay/llm-gateway',
            '@overlay/modules-react',
            '@overlay/tools-core',
            '@overlay/ui'
          ]
        })
      ],
      build: {
        rollupOptions: {
          external: ['uiohook-napi', 'form-data', 'node-fetch', '@lancedb/lancedb', 'node-pty']
        }
      },
      define: {
        'process.env.WORKOS_CLIENT_ID': JSON.stringify(workosClientId),
        'process.env.DEV_WORKOS_CLIENT_ID': JSON.stringify(devWorkosClientId),
        'process.env.WORKOS_REDIRECT_URI': JSON.stringify(workosRedirectUri),
        'process.env.SENTRY_DSN': JSON.stringify(sentryDsn),
        'process.env.APP_SERVER_URL': JSON.stringify(appServerUrl),
        // Bake the resolved Convex URL into the main bundle so packaged builds
        // do not rely on hardcoded deployment slugs in source.
        'process.env.CONVEX_URL': JSON.stringify(convexUrl),
        'process.env.NEXT_PUBLIC_CONVEX_URL': JSON.stringify(convexUrl)
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })]
    },
    renderer: {
      // Package the public assets committed to this standalone repository.
      publicDir: resolve('public'),
      server: {
        port: 5173,
        strictPort: true,
        watch: {
          ignored: [
            '**/out/**',
            '**/dist/**',
            '**/*.tsbuildinfo',
            '**/resources/models/**',
            '**/parakeet-bundle/**',
            '**/whisperkit-bundle/**',
            '**/node_modules/**'
          ]
        }
      },
      resolve: {
        dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react'],
        alias: {
          'react/jsx-dev-runtime': resolve('node_modules/react/jsx-dev-runtime.js'),
          'react/jsx-runtime': resolve('node_modules/react/jsx-runtime.js'),
          'react-dom': resolve('node_modules/react-dom'),
          react: resolve('node_modules/react'),
          '@renderer': resolve('src/renderer/src'),
          // Sub-path and CSS aliases MUST come before the parent package aliases
          // below. Vite alias resolution does prefix matching, so '@overlay/ui'
          // would match '@overlay/ui/primitives' and append '/primitives' to the
          // .ts entry file path. Putting more specific aliases first ensures
          // correct resolution.
          '@overlay/ui/styles.css': resolve('packages/overlay-ui/src/styles.css'),
          '@overlay/modules-react/knowledge-surface.css': resolve(
            'packages/overlay-modules-react/src/styles/knowledge-surface.css'
          ),
          '@overlay/modules-react/file-viewer.css': resolve(
            'packages/overlay-modules-react/src/styles/file-viewer.css'
          ),
          '@overlay/modules-react/notebook-editor.css': resolve(
            'packages/overlay-modules-react/src/styles/notebook-editor.css'
          ),
          '@overlay/modules-react/file-parity-fixture': resolve(
            'packages/overlay-modules-react/src/file-parity-fixture.tsx'
          ),
          '@overlay/modules-react/knowledge': resolve(
            'packages/overlay-modules-react/src/knowledge.tsx'
          ),
          '@overlay/modules-react/notes': resolve(
            'packages/overlay-modules-react/src/notes.tsx'
          ),
          '@overlay/modules-react/projects': resolve(
            'packages/overlay-modules-react/src/projects.tsx'
          ),
          '@overlay/app-core/file-viewer': resolve(
            'packages/overlay-app-core/src/file-viewer.ts'
          ),
          '@overlay/app-core/file-parity-fixtures': resolve(
            'packages/overlay-app-core/src/file-parity-fixtures.ts'
          ),
          '@overlay/ui/chat': resolve('packages/overlay-ui/src/chat.ts'),
          '@overlay/ui/overlays': resolve('packages/overlay-ui/src/overlays.ts'),
          '@overlay/ui/primitives': resolve('packages/overlay-ui/src/primitives.ts'),
          '@overlay/chat-react/chat-surface.css': resolve(
            'packages/overlay-chat-react/src/styles/chat-surface.css'
          ),
          '@overlay/chat-react/styles.css': resolve(
            'packages/overlay-chat-react/src/styles/overlay-theme.css'
          ),
          '@overlay/chat-react/sources-panel': resolve(
            'packages/overlay-chat-react/src/components/SourcesPanel.tsx'
          ),
          '@overlay/chat-react/transcript': resolve(
            'packages/overlay-chat-react/src/components/transcript/index.ts'
          ),
          '@overlay/chat-core/agent-assistant-text': resolve(
            'packages/overlay-chat-core/src/agent-assistant-text.ts'
          ),
          '@overlay/chat-core/generated-ui': resolve(
            'packages/overlay-chat-core/src/generated-ui.ts'
          ),
          '@overlay/chat-core/markdown-table-fix': resolve(
            'packages/overlay-chat-core/src/markdown-table-fix.ts'
          ),
          '@overlay/chat-core/parity-fixtures': resolve(
            'packages/overlay-chat-core/src/parity-fixtures.ts'
          ),
          '@overlay/chat-core/shim-incomplete-markdown': resolve(
            'packages/overlay-chat-core/src/shim-incomplete-markdown.ts'
          ),
          '@overlay/app-core/automations': resolve(
            'packages/overlay-app-core/src/automations.ts'
          ),
          '@overlay/app-core/extensions': resolve('packages/overlay-app-core/src/extensions.ts'),
          '@overlay/app-core/modules': resolve('packages/overlay-app-core/src/modules.ts'),
          '@overlay/app-core/settings-account': resolve(
            'packages/overlay-app-core/src/settings-account.ts'
          ),
          '@overlay/app-core/theme': resolve('packages/overlay-app-core/src/theme.ts'),
          '@overlay/app-core/contracts': resolve('packages/overlay-app-core/src/contracts.ts'),
          '@overlay/modules-react/shell': resolve(
            'packages/overlay-modules-react/src/shell.tsx'
          ),
          '@overlay/api-client': resolve('packages/overlay-api-client/src/index.ts'),
          '@overlay/auth-contracts': resolve('packages/overlay-auth-contracts/src/index.ts'),
          '@overlay/storage-contracts': resolve('packages/overlay-storage-contracts/src/index.ts'),
          '@overlay/modules-react/settings': resolve('packages/overlay-modules-react/src/settings.tsx'),
          '@overlay/app-core': resolve('packages/overlay-app-core/src/index.ts'),
          '@overlay/billing': resolve('packages/overlay-billing/src/index.ts'),
          '@overlay/chat-core': resolve('packages/overlay-chat-core/src/index.ts'),
          '@overlay/chat-react': resolve('packages/overlay-chat-react/src/index.ts'),
          '@overlay/llm-gateway': resolve('packages/overlay-llm-gateway/src/index.ts'),
          '@overlay/modules-react': resolve('packages/overlay-modules-react/src/index.ts'),
          '@overlay/tools-core': resolve('packages/overlay-tools-core/src/index.ts'),
          '@overlay/ui': resolve('packages/overlay-ui/src/index.ts')
        }
      },
      plugins: [react(), localResolvePlugin],
      define: {
        'import.meta.env.WORKOS_CLIENT_ID': JSON.stringify(workosClientId),
        'import.meta.env.DEV_WORKOS_CLIENT_ID': JSON.stringify(devWorkosClientId),
        'import.meta.env.WORKOS_REDIRECT_URI': JSON.stringify(workosRedirectUri),
        'import.meta.env.AUTH_STORAGE_KEY': JSON.stringify(authStorageKey),
        'import.meta.env.APP_SERVER_URL': JSON.stringify(appServerUrl),
        'import.meta.env.IS_DEV': JSON.stringify(String(isDev_workos)),
        'import.meta.env.SENTRY_DSN': JSON.stringify(sentryDsn),
        'import.meta.env.CONVEX_URL': JSON.stringify(convexUrl)
      }
    }
  }
})
