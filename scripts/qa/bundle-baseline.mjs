// Reports initial JS for the routes in the UI snappiness baseline. Unlike
// scripts/ci/check-bundle-budgets.mjs this never fails on size; it only
// records numbers so later PRs can show before/after.
//
// Usage (after `npm run analyze`, which builds into .next-analyze):
//   node scripts/qa/bundle-baseline.mjs --dist-dir=.next-analyze [--json]
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { measureRoute, readOption } from '../ci/bundle-measurements.mjs'

const ROUTES = ['/app/chat', '/app/files', '/app/agents', '/app/notes']

const distDir = path.resolve(readOption(process.argv, '--dist-dir', '.next'))
const readJson = async (file) => JSON.parse(await readFile(path.join(distDir, file), 'utf8'))
const manifest = await readJson('analyze/entrypoints.json')

const rows = []
for (const route of ROUTES) {
  const value = await measureRoute(distDir, manifest, route)
  rows.push({ route, routeGzip: value.routeGzipBytes, firstLoadGzip: value.firstLoadGzipBytes,
    routeRaw: value.routeRawBytes, firstLoadRaw: value.firstLoadRawBytes })
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  console.log('Webpack entrypoint JS, including ancestor layouts and runtime; excludes asynchronous imports, CSS and server payloads. Not a browser transfer measurement.\n')
  console.log('| Route | Route-only JS (gzip) | Entry JS (gzip) | Entry JS (raw) |')
  console.log('|---|---|---|---|')
  for (const row of rows) {
    console.log(`| ${row.route} | ${kib(row.routeGzip)} | ${kib(row.firstLoadGzip)} | ${kib(row.firstLoadRaw)} |`)
  }
}
