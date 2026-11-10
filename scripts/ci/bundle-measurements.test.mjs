import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { measureRoute, readOption, routeEntrypointFiles } from './bundle-measurements.mjs'
import { BundleEntrypointsPlugin } from './bundle-entrypoints-plugin.mjs'

const manifest = { version: 1, entries: {
  'main-app': ['static/runtime.js', 'static/shared.js'],
  'app-pages-internals': ['static/shared.js'],
  'app/layout': ['static/root.js', 'static/shared.js'],
  'app/(signed-in)/app/layout': ['static/shell.js'],
  'app/(signed-in)/app/chat/page': ['static/shared.js', 'static/shell.js', 'static/chat.js', 'static/chat.js'],
  'app/(signed-in)/app/files/page': ['static/files.js'],
} }

test('route totals include runtime and ancestor layouts once, excluding other routes', () => {
  assert.deepEqual(routeEntrypointFiles(manifest, '/app/chat'), {
    route: ['static/chat.js'],
    firstLoad: ['static/runtime.js', 'static/shared.js', 'static/root.js', 'static/shell.js', 'static/chat.js'],
  })
  assert.throws(() => routeEntrypointFiles(manifest, '/missing'), /Missing or ambiguous/)
  assert.throws(() => routeEntrypointFiles({ version: 0, entries: {} }, '/app/chat'), /Unsupported/)
  assert.throws(() => routeEntrypointFiles({ ...manifest, entries: {
    ...manifest.entries, 'app/other/(group)/page': [], 'app/(signed-in)/app/@slot/chat/page': [],
  } }, '/app/chat'), /ambiguous/)
  assert.throws(() => routeEntrypointFiles({ ...manifest, entries: {
    ...manifest.entries, 'main-app': undefined,
  } }, '/app/chat'), /missing bundle files/)
})

test('measurements use actual raw bytes and per-file gzip bytes, and reject missing or external files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'overlay-bundles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, 'static'))
  const contents = Object.fromEntries(['runtime', 'shared', 'root', 'shell', 'chat'].map(name => [name, Buffer.from(`${name}: ${'x'.repeat(100)}`)]))
  await Promise.all(Object.entries(contents).map(([name, value]) => writeFile(path.join(directory, `static/${name}.js`), value)))
  assert.deepEqual(await measureRoute(directory, manifest, '/app/chat'), {
    routeRawBytes: contents.chat.length, routeGzipBytes: gzipSync(contents.chat).length,
    firstLoadRawBytes: Object.values(contents).reduce((sum, value) => sum + value.length, 0),
    firstLoadGzipBytes: Object.values(contents).reduce((sum, value) => sum + gzipSync(value).length, 0),
  })
  await assert.rejects(measureRoute(directory, manifest, '/app/files'), /ENOENT/)
  await assert.rejects(measureRoute(directory, { ...manifest, entries: {
    ...manifest.entries, 'app/(signed-in)/app/chat/page': ['../outside.js'],
  } }, '/app/chat'), /outside the build directory/)
})

test('both dist-dir argument forms work and missing values fail', () => {
  assert.equal(readOption(['--dist-dir', 'build'], '--dist-dir', '.next'), 'build')
  assert.equal(readOption(['--dist-dir=build'], '--dist-dir', '.next'), 'build')
  assert.equal(readOption([], '--dist-dir', '.next'), '.next')
  for (const args of [['--dist-dir'], ['--dist-dir='], ['--dist-dir', '--json']]) {
    assert.throws(() => readOption(args, '--dist-dir', '.next'), /Missing value/)
  }
})

test('Next 16 builds without a separate app-pages-internals entry remain measurable', () => {
  const entries = { ...manifest.entries }
  delete entries['app-pages-internals']
  assert.deepEqual(routeEntrypointFiles({ version: 1, entries }, '/app/chat'),
    routeEntrypointFiles(manifest, '/app/chat'))
})

test('Webpack plugin records emitted entry JS, not async chunks, CSS or source maps', () => {
  let emitted
  class RawSource { constructor(value) { this.value = value } }
  const compilation = {
    entrypoints: new Map([['main-app', { getFiles: () => ['static/main.js', 'static/main.js.map', 'static/main.css', 'static/main.hot-update.js'] }]]),
    hooks: { processAssets: { tap: (_options, run) => run() } },
    emitAsset: (name, source) => { emitted = { name, value: JSON.parse(source.value) } },
  }
  new BundleEntrypointsPlugin().apply({
    webpack: { Compilation: { PROCESS_ASSETS_STAGE_REPORT: 5000 }, sources: { RawSource } },
    hooks: { thisCompilation: { tap: (_name, run) => run(compilation) } },
  })
  assert.deepEqual(emitted, { name: 'analyze/entrypoints.json', value: { version: 1, entries: { 'main-app': ['static/main.js'] } } })
})
