// Reports initial JS for the routes in the UI snappiness baseline. Unlike
// scripts/ci/check-bundle-budgets.mjs this never fails on size; it only
// records numbers so later PRs can show before/after.
//
// Usage (after `npm run analyze`, which builds into .next-analyze):
//   node scripts/qa/bundle-baseline.mjs --dist-dir=.next-analyze [--json]
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { getJsPageSizeInKb } = require('next/dist/build/utils')

const ROUTES = ['/app/chat', '/app/files', '/app/agents', '/app/notes']

function option(name, fallback) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : fallback
}

const distDir = path.resolve(option('--dist-dir', '.next'))
const readJson = async (file) => JSON.parse(await readFile(path.join(distDir, file), 'utf8'))
const buildManifest = await readJson('build-manifest.json')
const appBuildManifest = await readJson('app-build-manifest.json')

const rows = []
for (const route of ROUTES) {
  const measure = (gzip) => getJsPageSizeInKb('app', route, distDir, buildManifest, structuredClone(appBuildManifest), gzip)
  const [routeGzip, firstLoadGzip] = await measure(true)
  const [routeRaw, firstLoadRaw] = await measure(false)
  // getJsPageSizeInKb returns -1 for routes missing from the manifest.
  if (firstLoadRaw < 0) continue
  rows.push({ route, routeGzip, firstLoadGzip, routeRaw, firstLoadRaw })
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  console.log('| Route | Route JS (gzip) | First load (gzip) | First load (raw) |')
  console.log('|---|---|---|---|')
  for (const row of rows) {
    console.log(`| ${row.route} | ${kib(row.routeGzip)} | ${kib(row.firstLoadGzip)} | ${kib(row.firstLoadRaw)} |`)
  }
}
