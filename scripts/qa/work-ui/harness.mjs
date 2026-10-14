// Builds and serves the real Work UI in an isolated browser page, backed by an in-page fake API (see fake-work-api.ts).
// Used by scripts/qa/work-ui-qa.mjs. Needs Playwright's Chromium (see docs/develop/browser-testing-with-agent-browser.md).
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const here = fileURLToPath(new URL('./', import.meta.url))

/** Modules that need the Next.js runtime, a session, or a workspace are swapped for small shims. */
const SHIMS = {
  'next/navigation': 'shims/next-navigation.ts',
  'next/link': 'shims/next-link.tsx',
  '@/contexts/AuthContext': 'shims/auth-context.ts',
  '@/contexts/WorkspaceContext': 'shims/workspace-context.ts',
  '@/hooks/use-workspace-create-access': 'shims/use-workspace-create-access.ts',
  '@/hooks/use-solo-workspace': 'shims/use-solo-workspace.ts',
  '@/components/providers/CapabilitiesProvider': 'shims/capabilities-provider.ts',
  '@/components/providers/AuthorizationProvider': 'shims/authorization-provider.ts',
}

function shimPlugin() {
  return {
    name: 'work-ui-shims',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        const shim = SHIMS[args.path]
        return shim ? { path: path.join(here, shim) } : undefined
      })
    },
  }
}

async function compileCss() {
  const source = path.join(root, 'src/app/globals.css')
  const css = await readFile(source, 'utf8')
  // The root layout imports the chat surface styles globally; Markdown (the task objective) relies on them.
  const chat = await readFile(path.join(root, 'packages/overlay-chat-react/src/styles/chat-surface.css'), 'utf8')
  const result = await postcss([tailwind()]).process(css, { from: source })
  return `${result.css}\n${chat}`
}

export async function startWorkHarness() {
  const directory = await mkdtemp(path.join(tmpdir(), 'overlay-work-qa-'))
  const [css, bundle] = await Promise.all([
    compileCss(),
    build({
      entryPoints: [path.join(here, 'harness-entry.tsx')],
      bundle: true,
      write: false,
      format: 'iife',
      jsx: 'automatic',
      tsconfig: path.join(root, 'tsconfig.json'),
      plugins: [shimPlugin()],
      define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_APP_ENV': '"qa"' },
      loader: { '.svg': 'dataurl', '.png': 'dataurl', '.css': 'empty' },
      logLevel: 'error',
    }),
  ])
  const js = bundle.outputFiles[0].text.replaceAll('</script>', '<\\/script>')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`
  await writeFile(path.join(directory, 'index.html'), html)
  const server = createServer(async (_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(await readFile(path.join(directory, 'index.html')))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Harness server did not start')
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      await rm(directory, { recursive: true, force: true })
    },
  }
}
