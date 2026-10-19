/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Stylesheet imports are a bundler concern; Node cannot parse them. Component
 * tests that render markdown (which pulls in KaTeX's stylesheet) preload this
 * so the import resolves to an empty module.
 */

const Module = require('node:module')

const originalLoad = Module._load

Module._load = function loadWithStyleNoop(request, parent, isMain) {
  if (/\.(?:css|scss|sass|less)$/.test(request)) {
    return {}
  }
  return originalLoad.call(this, request, parent, isMain)
}

/**
 * Some markdown packages (streamdown, @streamdown/math, remend) only export an
 * `import` condition. Node can `require()` their ESM, but CommonJS resolution
 * rejects the export map, so fall back to the package's `import` entry.
 */
const fs = require('node:fs')
const path = require('node:path')

const originalResolve = Module._resolveFilename

function esmOnlyEntry(request, parent) {
  const match = /^((?:@[^/]+\/)?[^/.][^/]*)$/.exec(request)
  if (!match) return null
  const dirs = Module._nodeModulePaths(parent?.filename ? path.dirname(parent.filename) : process.cwd())
  for (const dir of dirs) {
    const pkgPath = path.join(dir, request, 'package.json')
    if (!fs.existsSync(pkgPath)) continue
    const root = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).exports?.['.']
    const entry = typeof root?.import === 'string' ? root.import : root?.import?.default
    return entry ? path.join(dir, request, entry) : null
  }
  return null
}

Module._resolveFilename = function resolveEsmOnly(request, parent, ...rest) {
  try {
    return originalResolve.call(this, request, parent, ...rest)
  } catch (error) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
    const entry = esmOnlyEntry(request, parent)
    if (!entry) throw error
    return entry
  }
}
