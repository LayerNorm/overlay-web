// Builds overlay-app.html: the real Overlay web app shell and pages, bundled with esbuild and fed fixture data.
//   node internal/plans/mockups/overlay-app/build.mjs
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const here = fileURLToPath(new URL('./', import.meta.url))
const locationBanner = await readFile(path.join(here, 'shims/location-banner.js'), 'utf8')

const SHIMS = {
  'next/navigation': 'shims/next-navigation.ts',
  'next/link': 'shims/next-link.tsx',
  'next/dynamic': 'shims/next-dynamic.tsx',
  'next/image': 'shims/next-image.tsx',
  'convex/react': 'shims/convex-react.tsx',
}

function shimPlugin() {
  return {
    name: 'overlay-app-shims',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        const shim = SHIMS[args.path]
        return shim ? { path: path.join(here, shim) } : undefined
      })
      b.onResolve({ filter: /^(server-only|fs|stream|zlib|path|crypto|os|http|https|net|tls|child_process|worker_threads|node:.*)$/ }, () => ({ path: path.join(here, 'shims/empty.ts') }))
    },
  }
}

async function compileCss() {
  const source = path.join(root, 'src/app/globals.css')
  const css = await readFile(source, 'utf8')
  const chat = await readFile(path.join(root, 'packages/overlay-chat-react/src/styles/chat-surface.css'), 'utf8')
  const result = await postcss([tailwind()]).process(css, { from: source })
  return `${result.css}\n${chat}`
}

const [css, bundle] = await Promise.all([
  compileCss(),
  build({
    entryPoints: [path.join(here, 'entry.tsx')],
    bundle: true,
    write: false,
    outdir: path.join(here, '.out'),
    minify: process.env.MOCKUP_MINIFY !== '0',
    format: 'iife',
    jsx: 'automatic',
    tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [shimPlugin()],
    define: {
      'process.env.NODE_ENV': process.env.MOCKUP_DEV === '1' ? '"development"' : '"production"',
      'process.env.NEXT_PUBLIC_APP_ENV': '"mockup"',
      'process.env.NEXT_PUBLIC_CONVEX_URL': '"https://mockup.convex.cloud"',
      ...Object.fromEntries(['pathname', 'search', 'hash', 'href', 'origin', 'host', 'hostname', 'protocol', 'assign', 'replace', 'reload'].flatMap((key) => [
        ['window.location.' + key, 'globalThis.__mockupLocation.' + key],
        ['location.' + key, 'globalThis.__mockupLocation.' + key],
      ])),
      'window.location': 'globalThis.__mockupLocation',
    },
    loader: { '.module.css': 'local-css', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.css': 'empty', '.woff2': 'dataurl' },
    banner: { js: locationBanner + 'var process = { env: { NODE_ENV: "production", NEXT_PUBLIC_APP_ENV: "mockup", NEXT_PUBLIC_CONVEX_URL: "https://mockup.convex.cloud" }, browser: true, version: "", versions: {}, platform: "browser", cwd: function () { return "/" }, nextTick: function (fn) { Promise.resolve().then(fn) } };' },
    logLevel: 'error',
  }),
])
const MIME = { png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' }
/** Public assets referenced by absolute path become data URLs, so the file opens from disk. */
async function inlinePublicAssets(source) {
  const paths = [...new Set(source.match(/\/(?:assets|icons|images|logos)\/[A-Za-z0-9_./-]+\.(?:png|svg|jpe?g|webp|gif|ico)/g) ?? [])]
  let out = source
  for (const asset of paths) {
    const extension = asset.split('.').pop().toLowerCase()
    try {
      const data = await readFile(path.join(root, 'public', asset))
      out = out.split(asset).join(`data:${MIME[extension]};base64,${data.toString('base64')}`)
    } catch {
      // Not a public file; leave the reference alone.
    }
  }
  return out
}
const js = (await inlinePublicAssets(bundle.outputFiles.find((file) => file.path.endsWith('.js')).text)).replaceAll('</script>', '<\\/script>')
const moduleCss = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''
const out = path.join(here, '../overlay-app.html')
await writeFile(out, `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Overlay | Web app mockup</title><style>${css}\n${moduleCss}</style></head><body><div id="root"></div><script>${js}</script></body></html>`)
console.log(`Built ${path.relative(root, out)}`)
