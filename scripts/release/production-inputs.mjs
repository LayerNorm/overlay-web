import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

/** Include Convex's imported shared code and dependencies, not unrelated UI. */
export function backendInputsChanged({ previousSha, sha, root, run }) {
  if (!/^[a-f0-9]{40}$/.test(previousSha ?? '')) return true
  const git = args => run('git', args, { cwd: root })
  const changed = git(['diff', '--name-only', '--no-renames', previousSha, sha]).split('\n').filter(Boolean)
  if (!changed.length) return false
  if (changed.some(path => path.startsWith('convex/')
    && !/\.(?:convex\.)?test\.[cm]?[jt]sx?$/.test(path))) return true
  const configFile = resolve(root, 'convex/tsconfig.json')
  const config = ts.readConfigFile(configFile, ts.sys.readFile)
  if (config.error) throw new Error('Cannot inspect Convex build inputs')
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(root, 'convex'))
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const inputs = new Set(), dependencies = new Set(['convex'])
  for (const file of program.getSourceFiles()) {
    const path = relative(root, file.fileName).replaceAll('\\', '/')
    if (!path.startsWith('../') && !path.includes('node_modules/')) inputs.add(path)
    // Workspace symlinks may resolve through the canonical checkout.
    for (const marker of ['/packages/', '/src/']) {
      const index = file.fileName.lastIndexOf(marker)
      if (index >= 0 && !file.fileName.includes('/node_modules/')) inputs.add(file.fileName.slice(index + 1))
    }
    for (const match of file.fileName.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/g)) dependencies.add(match[1])
  }
  if (changed.some(path => inputs.has(path))) return true
  if (!changed.includes('package-lock.json')) return false
  const before = JSON.parse(git(['show', previousSha + ':package-lock.json'])).packages
  const after = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')).packages
  // Declaration imports omit implementation-only transitive dependencies.
  const selected = new Set()
  let count
  do {
    count = dependencies.size
    for (const [path, entry] of [...Object.entries(before), ...Object.entries(after)]) {
      const name = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)?.[1]
      if (!name || !dependencies.has(name)) continue
      selected.add(path)
      for (const dependency of Object.keys(entry.dependencies ?? {})) dependencies.add(dependency)
      for (const dependency of Object.keys(entry.optionalDependencies ?? {})) dependencies.add(dependency)
    }
  } while (dependencies.size !== count)
  return [...selected].some(path => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
}
