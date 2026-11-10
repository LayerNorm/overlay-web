import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

export function readOption(args, name, fallback) {
  const inline = args.find(arg => arg.startsWith(`${name}=`))
  const index = args.indexOf(name)
  const value = inline ? inline.slice(name.length + 1) : index < 0 ? fallback : args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
  return value
}

export function routeEntrypointFiles(manifest, route) {
  if (manifest.version !== 1 || !manifest.entries || typeof manifest.entries !== 'object') {
    throw new Error('Unsupported bundle entrypoint manifest; rebuild with the current Webpack config')
  }
  const entries = manifest.entries
  const pages = Object.keys(entries).filter(entry => entry.startsWith('app/') && entry.endsWith('/page'))
  const matches = pages.filter(entry => '/' + entry.split('/').slice(1, -1)
    .filter(segment => !/^\([^)]*\)$/.test(segment) && !segment.startsWith('@')).join('/') === route)
  if (matches.length !== 1 || matches[0].includes('/@')) throw new Error(`Missing or ambiguous bundle entrypoint for ${route}`)
  const page = matches[0]
  const segments = page.split('/').slice(0, -1)
  const parents = ['main-app', 'app-pages-internals']
  for (let length = 1; length <= segments.length; length++) {
    const layout = `${segments.slice(0, length).join('/')}/layout`
    if (layout in entries) parents.push(layout)
  }
  function files(entry) {
    const value = entries[entry]
    if (!Array.isArray(value) || value.some(file => typeof file !== 'string' || !file.endsWith('.js'))) {
      throw new Error(`Invalid or missing bundle files for ${entry}`)
    }
    return value
  }
  const shared = new Set(parents.flatMap(files))
  const pageFiles = files(page)
  const firstLoad = [...new Set([...shared, ...pageFiles])]
  if (!firstLoad.length) throw new Error(`Empty bundle measurement for ${route}`)
  return { route: [...new Set(pageFiles)].filter(file => !shared.has(file)), firstLoad }
}

export async function measureRoute(distDir, manifest, route) {
  const files = routeEntrypointFiles(manifest, route)
  const sizes = new Map(await Promise.all(files.firstLoad.map(async file => {
    const absolute = path.resolve(distDir, file)
    const relative = path.relative(path.resolve(distDir), absolute)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Bundle file is outside the build directory')
    const content = await readFile(absolute)
    return [file, { raw: content.length, gzip: gzipSync(content).length }]
  })))
  const sum = (names, metric) => names.reduce((total, name) => total + sizes.get(name)[metric], 0)
  return {
    routeGzipBytes: sum(files.route, 'gzip'), firstLoadGzipBytes: sum(files.firstLoad, 'gzip'),
    routeRawBytes: sum(files.route, 'raw'), firstLoadRawBytes: sum(files.firstLoad, 'raw'),
  }
}
