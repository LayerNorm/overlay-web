/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const appRoot = path.resolve(__dirname, '..')
const inputPath = path.join(appRoot, 'assets/shared-markdown.input.css')
const outputPath = path.join(appRoot, 'assets/shared-markdown.generated.css')
const katexSourcePath = path.join(appRoot, '../node_modules/katex/dist/katex.min.css')
const katexOutputPath = path.join(appRoot, 'assets/shared-markdown-katex.generated.css')
const prepareScript = fs.readFileSync(path.join(appRoot, 'scripts/prepare-eas-workspace.cjs'), 'utf8')
const revisionMatch = prepareScript.match(/const WEB_REVISION\s*=\s*['"]([a-f0-9]{40})['"]/)

const URL_PATTERN = /url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/gi
const FONT_MIME_TYPES = {
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function extractUrls(value) {
  return [...value.matchAll(URL_PATTERN)].map((match) => (match[2] ?? match[3] ?? '').trim())
}

function readLocalFont(url, stylesheetPath, allowedRoot) {
  if (/^(?:https?:|\/\/)/i.test(url)) throw new Error(`Remote CSS font is forbidden: ${url}`)
  const assetPath = path.resolve(path.dirname(stylesheetPath), decodeURIComponent(url.split(/[?#]/, 1)[0]))
  const relativePath = path.relative(allowedRoot, assetPath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`CSS font escapes its workspace: ${url}`)
  }
  const mimeType = FONT_MIME_TYPES[path.extname(assetPath).toLowerCase()]
  if (!mimeType) throw new Error(`Unsupported local CSS asset: ${url}`)
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    throw new Error(`Missing local CSS font: ${assetPath}`)
  }
  return { mimeType, contents: fs.readFileSync(assetPath) }
}

function inlineLocalFontUrls(css, stylesheetPath, allowedRoot) {
  let count = 0
  const rewritten = css.replace(URL_PATTERN, (whole, quote, quoted, unquoted) => {
    const url = (quoted ?? unquoted ?? '').trim()
    if (!url || url.startsWith('#')) return whole
    if (url.startsWith('data:')) return whole
    const { mimeType, contents } = readLocalFont(url, stylesheetPath, allowedRoot)
    count += 1
    return `url("data:${mimeType};base64,${contents.toString('base64')}")`
  })
  return { css: rewritten, count }
}

function inlineKatexFonts(postcss, webRoot) {
  const root = postcss.parse(fs.readFileSync(katexSourcePath, 'utf8'), { from: katexSourcePath })
  let fontFaceCount = 0
  root.walkAtRules('import', (rule) => {
    if (/^(?:url\()?\s*["']?(?:https?:)?\/\//i.test(rule.params)) {
      throw new Error(`Remote KaTeX CSS import is forbidden: ${rule.params}`)
    }
  })
  root.walkAtRules('font-face', (rule) => {
    let source
    rule.walkDecls('src', (declaration) => { source = declaration })
    const woff2 = source && extractUrls(source.value).find((url) => url.endsWith('.woff2'))
    if (!woff2) throw new Error('KaTeX font-face has no WOFF2 source')
    const { contents } = readLocalFont(woff2, katexSourcePath, webRoot)
    source.value = `url("data:font/woff2;base64,${contents.toString('base64')}") format("woff2")`
    fontFaceCount += 1
  })
  if (fontFaceCount !== 20) throw new Error(`Expected 20 KaTeX WOFF2 font faces, found ${fontFaceCount}`)
  return { css: root.toString(), fontFaceCount }
}

async function main() {
  if (!revisionMatch) throw new Error('Could not read the EAS web revision pin')

  const packageRoot = fs.realpathSync(path.join(appRoot, '../packages/overlay-chat-react'))
  const webRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: packageRoot,
    encoding: 'utf8',
  }).trim()
  const pin = revisionMatch[1]
  const sourcePaths = [
    'package.json',
    'package-lock.json',
    'packages/overlay-chat-react',
    'packages/overlay-chat-core',
    'packages/overlay-modules-react',
    'packages/overlay-ui',
  ]
  const sourceStatus = execFileSync('git', ['status', '--porcelain', '--', ...sourcePaths], {
    cwd: webRoot,
    encoding: 'utf8',
  }).trim()
  if (sourceStatus) throw new Error(`Pinned shared Markdown sources have local changes:\n${sourceStatus}`)

  const sourceDiff = spawnSync('git', ['diff', '--quiet', pin, 'HEAD', '--', ...sourcePaths], {
    cwd: webRoot,
    encoding: 'utf8',
  })
  if (sourceDiff.status !== 0) {
    throw new Error(`Shared Markdown sources differ from EAS web pin ${pin}`)
  }

  const chatTree = execFileSync('git', ['rev-parse', `${pin}:packages/overlay-chat-react`], {
    cwd: webRoot,
    encoding: 'utf8',
  }).trim()
  const postcssPath = path.join(webRoot, 'node_modules/postcss')
  const tailwindPath = path.join(webRoot, 'node_modules/@tailwindcss/postcss/dist/index.mjs')
  const tailwindPackage = JSON.parse(fs.readFileSync(path.join(webRoot, 'node_modules/@tailwindcss/postcss/package.json'), 'utf8'))
  const katexPackage = JSON.parse(fs.readFileSync(path.join(webRoot, 'node_modules/katex/package.json'), 'utf8'))
  const webLock = JSON.parse(fs.readFileSync(path.join(webRoot, 'package-lock.json'), 'utf8'))
  if (webLock.packages?.['node_modules/katex']?.version !== katexPackage.version) {
    throw new Error('Installed KaTeX version does not match the pinned web lockfile')
  }
  const postcss = require(postcssPath)
  const tailwind = (await import(pathToFileURL(tailwindPath).href)).default

  const themePath = path.join(webRoot, 'packages/overlay-chat-react/src/styles/overlay-theme.css')
  const theme = postcss.parse(fs.readFileSync(themePath, 'utf8'), { from: themePath })
  let removedRemoteFonts = 0
  let rewrittenChatStyles = 0
  theme.walkAtRules('import', (rule) => {
    if (rule.params.includes('fonts.googleapis.com')) {
      rule.remove()
      removedRemoteFonts += 1
      return
    }
    if (rule.params.replace(/^['"]|['"]$/g, '') === './chat-surface.css') {
      rule.params = '"@overlay/chat-react/chat-surface.css"'
      rewrittenChatStyles += 1
    }
  })
  if (removedRemoteFonts !== 1 || rewrittenChatStyles !== 1) {
    throw new Error('Unexpected shared theme font or chat stylesheet imports')
  }

  const source = fs.readFileSync(inputPath, 'utf8')
  const themeImport = '@import "__overlay_chat_theme__";'
  if (source.split(themeImport).length !== 2) throw new Error('Expected one shared theme placeholder')
  const cssInput = source.replace(themeImport, theme.toString())
  const result = await postcss([tailwind()]).process(cssInput, {
    from: inputPath,
    to: outputPath,
    map: false,
  })
  const localFonts = inlineLocalFontUrls(result.css, outputPath, appRoot)
  const katex = inlineKatexFonts(postcss, webRoot)
  if (/@import\s+(?:url\()?['"]?https?:\/\//i.test(localFonts.css) || /url\(\s*['"]?https?:\/\//i.test(localFonts.css)) {
    throw new Error('Generated shared Markdown CSS contains a remote asset')
  }
  fs.writeFileSync(outputPath, localFonts.css)
  fs.writeFileSync(katexOutputPath, katex.css)
  const verification = require('./verify-shared-markdown-assets.cjs').verifySourceStylesheets({ appRoot })
  console.log(`Shared Markdown CSS built from EAS pin ${pin} (chat-react tree ${chatTree}).`)
  console.log(`Tailwind ${tailwindPackage.version}; KaTeX ${katexPackage.version}; embedded ${localFonts.count} local fonts and ${katex.fontFaceCount} KaTeX WOFF2 fonts.`)
  console.log(`Verified ${verification.urlCount} CSS URLs; no remote imports or unresolved local targets.`)
  console.log(`Wrote ${path.relative(appRoot, outputPath)} (${Buffer.byteLength(localFonts.css)} bytes).`)
  console.log(`Wrote ${path.relative(appRoot, katexOutputPath)} (${Buffer.byteLength(katex.css)} bytes).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
