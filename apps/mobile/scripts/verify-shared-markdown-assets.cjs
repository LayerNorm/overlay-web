/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const appRoot = path.resolve(__dirname, '..')
const sourceStylesheets = [
  path.join(appRoot, 'assets/shared-markdown.generated.css'),
  path.join(appRoot, 'assets/shared-markdown-katex.generated.css'),
]
const URL_PATTERN = /url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/gi

function isRemote(url) {
  return /^(?:https?:|\/\/)/i.test(url)
}

function verifyCssContent(css, cssPath, rootPath) {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of uncommented.matchAll(/@import\s+([^;]+);/gi)) {
    const importTarget = match[1].trim()
      .replace(/^url\(\s*/i, '')
      .replace(/\s*\)$/, '')
      .replace(/^(['"])(.*)\1$/, '$2')
      .split(/\s+/, 1)[0]
    if (isRemote(importTarget)) throw new Error(`${cssPath}: remote CSS import is forbidden`)
    if (!importTarget || importTarget.startsWith('data:')) continue
    const importPath = decodeURIComponent(importTarget.split(/[?#]/, 1)[0])
    const target = path.resolve(path.dirname(cssPath), importPath)
    const relative = path.relative(rootPath, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${cssPath}: CSS import escapes the asset root: ${importTarget}`)
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`${cssPath}: CSS import target is missing: ${importTarget}`)
    }
  }

  const urls = [...uncommented.matchAll(URL_PATTERN)].map((match) => (match[2] ?? match[3] ?? '').trim())
  const localTargets = []
  const fontDataHashes = []
  for (const url of urls) {
    if (!url || url.startsWith('#')) continue
    if (isRemote(url)) throw new Error(`${cssPath}: remote CSS URL is forbidden: ${url}`)
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',')
      if (comma < 0) throw new Error(`${cssPath}: malformed CSS data URL`)
      const metadata = url.slice(5, comma)
      const payload = url.slice(comma + 1)
      let bytes
      if (/;base64$/i.test(metadata)) {
        bytes = Buffer.from(payload, 'base64')
        if (!bytes.length || bytes.toString('base64') !== payload) {
          throw new Error(`${cssPath}: invalid base64 CSS data URL`)
        }
      } else {
        bytes = Buffer.from(decodeURIComponent(payload))
        if (!bytes.length) throw new Error(`${cssPath}: empty CSS data URL`)
      }
      if (/^font\//i.test(metadata)) fontDataHashes.push(crypto.createHash('sha256').update(bytes).digest('hex'))
      continue
    }

    const pathname = decodeURIComponent(url.split(/[?#]/, 1)[0])
    const target = pathname.startsWith('/')
      ? path.resolve(rootPath, `.${pathname}`)
      : path.resolve(path.dirname(cssPath), pathname)
    const relative = path.relative(rootPath, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${cssPath}: CSS URL escapes the asset root: ${url}`)
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`${cssPath}: CSS URL target is missing: ${url}`)
    }
    localTargets.push(target)
  }
  return { urlCount: urls.length, localTargets, fontDataHashes, fontFaceCount: (uncommented.match(/@font-face\b/gi) || []).length }
}

function verifySourceStylesheets({ appRoot: root = appRoot } = {}) {
  const results = sourceStylesheets.map((cssPath) => {
    if (!fs.existsSync(cssPath)) throw new Error(`Generated stylesheet is missing: ${cssPath}`)
    return verifyCssContent(fs.readFileSync(cssPath, 'utf8'), cssPath, root)
  })
  if (results[0].fontFaceCount !== 6) throw new Error(`Expected 6 shared theme font faces, found ${results[0].fontFaceCount}`)
  if (results[1].fontFaceCount !== 20) throw new Error(`Expected 20 KaTeX font faces, found ${results[1].fontFaceCount}`)
  if (results.some((result) => result.fontDataHashes.length !== result.fontFaceCount)) {
    throw new Error('Every generated @font-face must contain one embedded local font payload')
  }
  if (results.some((result) => result.localTargets.length > 0)) {
    throw new Error('Generated shared Markdown CSS must embed its font URLs rather than retain relative paths')
  }
  return {
    urlCount: results.reduce((total, result) => total + result.urlCount, 0),
    fontDataHashes: results.flatMap((result) => result.fontDataHashes),
    fontFaceCount: results.reduce((total, result) => total + result.fontFaceCount, 0),
  }
}

function verifyExport(exportDir, platform = 'android') {
  if (!['android', 'ios'].includes(platform)) throw new Error(`Unsupported Expo platform: ${platform}`)
  const metadataPath = path.join(exportDir, 'metadata.json')
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  const nativeExport = metadata.fileMetadata?.[platform]
  if (!nativeExport?.bundle || !fs.existsSync(path.join(exportDir, nativeExport.bundle))) {
    throw new Error(`${platform} export bundle is missing from Expo metadata or disk`)
  }
  const bundleDir = path.join(exportDir, 'www.bundle')
  const cssFiles = fs.readdirSync(bundleDir).filter((name) => name.endsWith('.css'))
  const htmlFiles = fs.readdirSync(bundleDir).filter((name) => name.endsWith('.html'))
  if (cssFiles.length < 2 || htmlFiles.length === 0) throw new Error('Expo DOM CSS or HTML bundle is missing')

  const exported = cssFiles.map((name) => {
    const cssPath = path.join(bundleDir, name)
    const css = fs.readFileSync(cssPath, 'utf8')
    return { name, css, ...verifyCssContent(css, cssPath, exportDir) }
  })
  const sharedCss = exported.find(({ css }) => css.includes('shared-markdown-viewport'))
  const katexCss = exported.find(({ css }) => css.includes('KaTeX_Main') && css.includes('katex-display'))
  if (!sharedCss || !katexCss) throw new Error('Export does not contain both shared Markdown and KaTeX stylesheets')
  if (exported.some((result) => result.localTargets.length > 0)) {
    throw new Error('Exported DOM CSS contains a relative URL that is not bundled with the stylesheet')
  }

  for (const htmlName of htmlFiles) {
    const htmlPath = path.join(bundleDir, htmlName)
    const html = fs.readFileSync(htmlPath, 'utf8')
    const hrefs = [...html.matchAll(/<link\b[^>]*\bhref=(['"])(.*?)\1/gi)].map((match) => match[2])
    for (const href of hrefs.filter((value) => value.endsWith('.css'))) {
      if (isRemote(href)) throw new Error(`${htmlPath}: remote stylesheet link is forbidden`)
      const cssTarget = href.startsWith('/')
        ? path.resolve(exportDir, `.${href}`)
        : path.resolve(path.dirname(htmlPath), href)
      if (!fs.existsSync(cssTarget) || !fs.statSync(cssTarget).isFile()) {
        throw new Error(`${htmlPath}: linked CSS file is missing: ${href}`)
      }
    }
  }

  const expectedFonts = new Set(verifySourceStylesheets().fontDataHashes)
  const exportedFonts = new Set(exported.flatMap((result) => result.fontDataHashes))
  const missingFonts = [...expectedFonts].filter((hash) => !exportedFonts.has(hash))
  if (missingFonts.length > 0) throw new Error(`Exported DOM CSS is missing ${missingFonts.length} embedded font payload(s)`)
  return { cssFiles: cssFiles.length, fontPayloads: expectedFonts.size, fontFaces: sharedCss.fontFaceCount + katexCss.fontFaceCount }
}

function main() {
  const exportIndex = process.argv.indexOf('--export-dir')
  if (exportIndex >= 0) {
    const exportDir = path.resolve(appRoot, process.argv[exportIndex + 1] || '')
    const platformIndex = process.argv.indexOf('--platform')
    const platform = platformIndex >= 0 ? process.argv[platformIndex + 1] : 'android'
    const result = verifyExport(exportDir, platform)
    console.log(`Verified Expo ${platform} export: ${result.cssFiles} CSS files, ${result.fontFaces} font faces, ${result.fontPayloads} embedded font payloads; no remote or unresolved CSS URLs.`)
    return
  }
  const result = verifySourceStylesheets()
  console.log(`Verified generated CSS: ${result.urlCount} URLs, ${result.fontFaceCount} font faces, ${result.fontDataHashes.length} embedded font payloads; no remote or unresolved CSS URLs.`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = { verifyCssContent, verifySourceStylesheets, verifyExport }
