/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * The @blocknote/* packages crash under require() two ways in this repo's test
 * runner:
 *  1. tsx honors their `source` field, loading src/*.ts whose tiptap imports
 *     hit the CJS namespace interop bug (`te.default.extend is not a function`).
 *  2. dist/*.cjs has the same interop break.
 * The dist/*.js ESM builds work, and Node 22 can require() ES modules, so bare
 * `@blocknote/<pkg>` specifiers load the package's `module` entry instead.
 *
 * Dependencies inside that ESM graph are then resolved under `require`
 * conditions; packages that only declare an `import` export (e.g.
 * @handlewithcare/prosemirror-inputrules) throw ERR_PACKAGE_PATH_NOT_EXPORTED.
 * Fall back to their `import` entry so the same require-ESM path covers them.
 */

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const originalFindPath = Module._findPath
const esmPathCache = new Map()
const importOnlyCache = new Map()

function packageRoot(pkgName, parentDir) {
  let dir = parentDir
  for (;;) {
    const candidate = path.join(dir, 'node_modules', pkgName)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const next = path.dirname(dir)
    if (next === dir) return null
    dir = next
  }
}

function blocknoteEsmPath(specifier, parent) {
  if (!/^@blocknote\/[^/]+(\/.+)?$/.test(specifier) || specifier.endsWith('.css')) return null
  if (esmPathCache.has(specifier)) return esmPathCache.get(specifier)
  let resolved = null
  try {
    const pkgName = specifier.split('/').slice(0, 2).join('/')
    const subpath = specifier.slice(pkgName.length)
    const root = packageRoot(pkgName, parent ? parent.filename : process.cwd())
    if (root) {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
      const key = subpath === '' ? '.' : `.${subpath}`
      const entryDef = pkg.exports && pkg.exports[key]
      const entry =
        (entryDef && (typeof entryDef === 'string' ? entryDef : entryDef.import || entryDef.default)) ||
        (subpath === '' ? pkg.module : null)
      if (typeof entry === 'string') {
        const target = path.join(root, entry)
        const candidate = target.endsWith('.cjs') ? target.replace(/\.cjs$/, '.js') : target
        if (fs.existsSync(candidate)) resolved = candidate
        else if (fs.existsSync(target)) resolved = target
      }
    }
  } catch {
    resolved = null
  }
  esmPathCache.set(specifier, resolved)
  return resolved
}

Module._load = function loadBlocknoteEsm(request, parent, isMain) {
  const esmPath = blocknoteEsmPath(request, parent)
  if (esmPath) return originalLoad.call(this, esmPath, parent, isMain)
  const loaded = originalLoad.call(this, request, parent, isMain)
  // The @blocknote dist/*.cjs bundles wrap default imports as
  // `toESM(require('@tiptap/x'), 1)`, which always binds the whole namespace
  // (`te.default` is the exports object, not `exports.default`), so
  // `te.default.extend` crashes. Alias the extension methods onto the
  // namespace so the wrapped binding resolves.
  if (
    request.startsWith('@tiptap/') &&
    loaded &&
    typeof loaded === 'object' &&
    loaded.default &&
    typeof loaded.default === 'object'
  ) {
    for (const key of ['extend', 'configure']) {
      if (typeof loaded[key] !== 'function' && typeof loaded.default[key] === 'function') {
        try {
          loaded[key] = loaded.default[key]
        } catch {
          // non-writable namespace — ignore
        }
      }
    }
  }
  return loaded
}

const BLOCKNOTE_SRC_ENTRY = /^(?<dir>.+?node_modules\/@blocknote\/[^/]+)\/src\/index\.ts$/
const srcRedirectCache = new Map()

// tsx resolves package specifiers in its own resolver (honoring the `source`
// field) and never delegates to _resolveFilename/_findPath for these, so the
// only always-hit chokepoint is the prototype load of the resolved file.
const originalProtoLoad = Module.prototype.load
Module.prototype.load = function loadWithBlocknoteRedirect(filename) {
  const match = BLOCKNOTE_SRC_ENTRY.exec(filename)
  if (match) {
    if (srcRedirectCache.has(filename)) {
      const cached = srcRedirectCache.get(filename)
      if (cached) { this.exports = cached; this.loaded = true; return }
    } else {
      let loadedExports = null
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(match.groups.dir, 'package.json'), 'utf8'))
        const entry = pkg.module || (pkg.exports && pkg.exports['.'] && pkg.exports['.'].import)
        if (typeof entry === 'string') {
          const target = path.join(match.groups.dir, entry)
          if (fs.existsSync(target)) loadedExports = originalLoad.call(this, target, this, false)
        }
      } catch {
        loadedExports = null
      }
      srcRedirectCache.set(filename, loadedExports)
      if (loadedExports) { this.exports = loadedExports; this.loaded = true; return }
    }
  }
  return originalProtoLoad.call(this, filename)
}

function importOnlyEntry(specifier, parent) {
  const isBare = !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:')
  const pkgName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
  if (!isBare || specifier !== pkgName) return null
  if (importOnlyCache.has(specifier)) return importOnlyCache.get(specifier)
  let resolved = null
  try {
    const root = packageRoot(specifier, parent ? parent.filename : process.cwd())
    if (root) {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
      const dot = pkg.exports && pkg.exports['.']
      const entry = (dot && (typeof dot === 'string' ? dot : dot.import)) || pkg.module
      if (entry && typeof entry === 'string') {
        const target = path.join(root, entry)
        if (fs.existsSync(target)) resolved = target
      }
    }
  } catch {
    resolved = null
  }
  importOnlyCache.set(specifier, resolved)
  return resolved
}

Module._resolveFilename = function resolveEsmFallbacks(request, parent, isMain, options) {
  try {
    return originalResolve.call(this, request, parent, isMain, options)
  } catch (error) {
    if (error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      const fallback = importOnlyEntry(request, parent)
      if (fallback) return fallback
    }
    throw error
  }
}
