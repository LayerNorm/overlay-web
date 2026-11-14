/* eslint-disable @typescript-eslint/no-require-imports */
require('tsx/cjs')
require('./register-shared-markdown-style-noop.cjs')
require('./register-shared-markdown-react.cjs')

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const React = require('../../node_modules/react')
const { renderToStaticMarkup } = require('../../node_modules/react-dom/server')
const { MarkdownMessage } = require('../../packages/overlay-chat-react/src/components/MarkdownMessage.tsx')
const {
  selectionNeedsReconstruction,
  textPointAtOffset,
  textSelectionPoints,
} = require('../lib/sharedMarkdownSelection.ts')
const {
  copyNativeMarkdownText,
  MAX_MARKDOWN_COPY_LENGTH,
  openValidatedMarkdownLink,
} = require('../lib/sharedMarkdownBridge.ts')
const { verifyCssContent } = require('./verify-shared-markdown-assets.cjs')
const {
  getWorkspaceLazyModulePath,
  resolveWorkspaceLazyModule,
} = require('./resolve-shared-markdown-lazy-module.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sampleCssPath = path.join(projectRoot, 'assets/shared-markdown-proof-test.css')

function renderMarkdown(text, isStreaming = false) {
  return renderToStaticMarkup(React.createElement(MarkdownMessage, {
    text,
    isStreaming,
    suppressTypingIndicator: true,
  }))
}

test('the shared MarkdownMessage renders the saved dots, fraction, and matrix with KaTeX', () => {
  const math = String.raw`\dots\quad\tfrac{1}{2}\quad\begin{bmatrix}1&2\\3&4\end{bmatrix}`
  const html = renderMarkdown(`$$${math}$$`)
  assert.match(html, /katex-display/)
  assert.match(html, /mfrac/)
  assert.match(html, /mtable/)
  assert.doesNotMatch(html, /katex-error|Invalid command/)
})

test('generated CSS uses bundled sans, serif, and mono stacks without variable cycles', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'assets/shared-markdown.generated.css'), 'utf8')
  const definitions = Object.fromEntries(['sans', 'serif', 'mono'].map((name) => [
    name,
    [...css.matchAll(new RegExp(`--font-${name}:\\s*([^;]+);`, 'g'))].map((match) => match[1]),
  ]))

  for (const [name, values] of Object.entries(definitions)) {
    assert.ok(values.length > 0, `missing --font-${name}`)
    for (const value of values) {
      assert.doesNotMatch(value, new RegExp(`var\\(\\s*--font-${name}\\s*[,)]`, 'i'))
    }
  }
  assert.ok(definitions.sans.some((value) => /var\(--font-geist\s*,/.test(value)))
  assert.ok(definitions.serif.some((value) => /var\(--font-serif-family\)/.test(value)))
  assert.ok(definitions.mono.some((value) => /ui-monospace,\s*SFMono-Regular/.test(value)))
  assert.match(css, /body\s*\{[^}]*font-family:\s*var\(--font-sans\)/s)
  assert.match(css, /\.shared-markdown-viewport\s*\{[^}]*font-family:\s*var\(--font-sans\)/s)
})

test('generated dark theme colors the Markdown viewport', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'assets/shared-markdown.generated.css'), 'utf8')
  assert.match(css, /\.shared-markdown-viewport\s*\{[^}]*background:\s*var\(--background\);[^}]*color:\s*var\(--foreground\);/s)
})

test('Expo route tree excludes the synthetic screen and preserves personal Chat', () => {
  const appRoot = path.join(projectRoot, 'app')
  const routeFiles = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) routeFiles.push(file)
    }
  }
  walk(appRoot)

  assert.equal(fs.existsSync(path.join(appRoot, 'dev/shared-markdown.tsx')), false)
  for (const file of routeFiles) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /SharedTranscriptProofMode|shared-transcript-proof-workspace|dev\/shared-markdown/)
  }

  const chatRoute = fs.readFileSync(path.join(appRoot, '(tabs)/chat.tsx'), 'utf8')
  const chatScreen = fs.readFileSync(path.join(projectRoot, 'components/chat/ChatScreen.tsx'), 'utf8')
  assert.match(chatRoute, /ChatScreen/)
  assert.match(chatScreen, /NativePersonalChatTranscript/)
})

test('selection fallback waits for detached endpoints and maps exact boundaries consistently', () => {
  const anchorNode = { connected: true }
  const focusNode = { connected: true }
  const savedSelection = { anchorNode, focusNode }
  const connected = new Set([anchorNode, focusNode])
  const isConnected = (node) => connected.has(node)

  assert.equal(selectionNeedsReconstruction(savedSelection, isConnected), false)
  connected.delete(focusNode)
  assert.equal(selectionNeedsReconstruction(savedSelection, isConnected), true)

  const textNodes = [
    { textContent: 'table ' },
    { textContent: 'Markdown' },
    { textContent: ' value' },
  ]
  const boundary = textPointAtOffset(textNodes, textNodes[0].textContent.length)
  assert.deepEqual(boundary, { node: textNodes[1], offset: 0 })

  const forward = textSelectionPoints(textNodes, 6, textNodes, 14)
  assert.deepEqual(forward, {
    anchor: { node: textNodes[1], offset: 0 },
    focus: { node: textNodes[2], offset: 0 },
  })
  const backward = textSelectionPoints(textNodes, 14, textNodes, 6)
  assert.deepEqual(backward, {
    anchor: { node: textNodes[2], offset: 0 },
    focus: { node: textNodes[1], offset: 0 },
  })
})

test('normal, empty, streaming, code, table, and unsafe-link Markdown render safely', () => {
  assert.match(renderMarkdown('# Proof'), /<h1/)
  assert.doesNotThrow(() => renderMarkdown(''))
  assert.doesNotMatch(renderMarkdown('Streaming $\\tfrac{1}{2}$', true), /katex-error/)
  const code = renderMarkdown('```ts\nconst value = 42\n```')
  assert.match(code, /data-slot="code-block-copy-button"/)
  assert.match(code, /data-slot="code-block-content"/)
  assert.match(renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |'), /<table/)
  assert.doesNotMatch(renderMarkdown('[blocked](javascript:alert(1))'), /href=["']javascript:/i)
})

test('native link adapter allows only safe HTTP(S) destinations and surfaces opener failures', async () => {
  const opened = []
  assert.equal(await openValidatedMarkdownLink('https://example.com/path', async (url) => opened.push(url)), true)
  assert.deepEqual(opened, ['https://example.com/path'])

  for (const url of ['javascript:alert(1)', 'data:text/html,evil', 'file:///etc/passwd', '//example.com', 'https://user:pass@example.com']) {
    assert.equal(await openValidatedMarkdownLink(url, async (value) => opened.push(value)), false)
  }
  assert.equal(await openValidatedMarkdownLink('', async (value) => opened.push(value)), false)
  assert.equal(opened.length, 1)
  await assert.rejects(
    openValidatedMarkdownLink('https://example.com', async () => { throw new Error('offline') }),
    /offline/,
  )
})

test('native copy adapter handles valid, empty, oversized, and failed writes', async () => {
  const copied = []
  assert.equal(await copyNativeMarkdownText('copy me', async (text) => copied.push(text)), true)
  assert.deepEqual(copied, ['copy me'])
  assert.equal(await copyNativeMarkdownText('', async (text) => copied.push(text)), false)
  assert.equal(await copyNativeMarkdownText('x'.repeat(MAX_MARKDOWN_COPY_LENGTH + 1), async (text) => copied.push(text)), false)
  assert.equal(copied.length, 1)
  await assert.rejects(copyNativeMarkdownText('copy me', async () => { throw new Error('clipboard unavailable') }), /clipboard unavailable/)
})

test('offline CSS verification accepts local and embedded fonts and empty stylesheets', () => {
  const css = '@font-face{src:url("../assets/fonts/libre-baskerville/static/LibreBaskerville-Regular.ttf")}@font-face{src:url("data:font/woff2;base64,AA==")}'
  const result = verifyCssContent(css, sampleCssPath, projectRoot)
  assert.equal(result.localTargets.length, 1)
  assert.equal(result.fontDataHashes.length, 1)
  assert.equal(verifyCssContent(':root{}', sampleCssPath, projectRoot).urlCount, 0)
})

test('offline CSS verification rejects remote imports and missing local targets', () => {
  assert.throws(
    () => verifyCssContent('@import url("https://fonts.googleapis.com/css?family=Geist");', sampleCssPath, projectRoot),
    /remote CSS import is forbidden/,
  )
  assert.throws(
    () => verifyCssContent('@font-face{src:url("./missing-font.woff2")}', sampleCssPath, projectRoot),
    /CSS URL target is missing/,
  )
})

test('Metro resolves the pinned Shiki lazy graph from the shared workspace', () => {
  const workspaceRoot = path.resolve(projectRoot, '..')
  const requests = [
    ['./node_modules/shiki/dist/core', 'shiki/dist/core.mjs'],
    ['./node_modules/shiki/dist/engine-javascript', 'shiki/dist/engine-javascript.mjs'],
    ['./node_modules/@shikijs/core/dist/index', '@shikijs/core/dist/index.mjs'],
    ['./node_modules/@shikijs/engine-javascript/dist/index', '@shikijs/engine-javascript/dist/index.mjs'],
    ['./node_modules/@shikijs/langs/dist/typescript', '@shikijs/langs/dist/typescript.mjs'],
    ['./node_modules/@shikijs/themes/dist/github-dark', '@shikijs/themes/dist/github-dark.mjs'],
    ['./node_modules/shiki/dist/wasm', 'shiki/dist/wasm.mjs'],
  ]
  for (const [request, packagePath] of requests) {
    const modulePath = getWorkspaceLazyModulePath(request, workspaceRoot)
    assert.equal(modulePath, path.join(workspaceRoot, 'node_modules', packagePath.replace(/\.mjs$/, '')))
    assert.ok(fs.existsSync(path.join(workspaceRoot, 'node_modules', packagePath)), `missing lazy module: ${packagePath}`)
  }

  const lock = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package-lock.json'), 'utf8'))
  for (const name of ['shiki', '@shikijs/core', '@shikijs/engine-javascript', '@shikijs/langs', '@shikijs/themes']) {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'node_modules', name, 'package.json'), 'utf8'))
    assert.equal(pkg.version, lock.packages[`node_modules/${name}`].version)
  }

  const dynamicImports = (file) => {
    const source = fs.readFileSync(path.join(workspaceRoot, 'node_modules', file), 'utf8')
    return [...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1])
  }
  assert.ok(dynamicImports('shiki/dist/langs.mjs').includes('@shikijs/langs/typescript'))
  assert.ok(dynamicImports('shiki/dist/themes.mjs').includes('@shikijs/themes/github-dark'))
  assert.ok(dynamicImports('shiki/dist/bundle-full.mjs').includes('shiki/wasm'))

  const request = './node_modules/@shikijs/langs/dist/typescript'
  const localResult = { source: 'app-local' }
  let usedWorkspace = false
  const localFirst = resolveWorkspaceLazyModule(
    request,
    workspaceRoot,
    () => localResult,
    () => {
      usedWorkspace = true
      return { source: 'workspace' }
    },
  )
  assert.equal(localFirst.matched, true)
  assert.equal(localFirst.resolution, localResult)
  assert.equal(usedWorkspace, false)

  const workspaceResult = { source: 'workspace' }
  const fallback = resolveWorkspaceLazyModule(
    request,
    workspaceRoot,
    () => { throw new Error('app-local module absent') },
    (modulePath) => {
      assert.equal(modulePath, path.join(workspaceRoot, 'node_modules/@shikijs/langs/dist/typescript'))
      return workspaceResult
    },
  )
  assert.equal(fallback.matched, true)
  assert.equal(fallback.resolution, workspaceResult)

  for (const unsafeOrUnrelated of [
    './components/Message',
    '../node_modules/@shikijs/langs/dist/typescript',
    '@shikijs/langs/typescript',
    './node_modules/@shikijs/langs/../../outside',
    './node_modules/@shikijs/langs\\outside',
  ]) {
    assert.equal(getWorkspaceLazyModulePath(unsafeOrUnrelated, workspaceRoot), null)
  }
})
