/**
 * Reads the monorepo's bun.lock for supply-chain checks (production audit,
 * licenses, SBOM). Works under Node and Bun.
 *
 * bun.lock lists every workspace's manifest under `workspaces` (keyed by folder)
 * and every installed package under `packages`, keyed the way Node would find
 * it: a top-level install by name ("zod"), a nested one by its parent's key
 * ("@vercel/cli-auth/zod"); a workspace's own nested installs use its package
 * name as the parent key ("overlay-desktop/vite").
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

export function readBunLock(root = REPOSITORY_ROOT) {
  // bun.lock is JSON with trailing commas.
  return JSON.parse(readFileSync(join(root, 'bun.lock'), 'utf8').replace(/,(\s*[}\]])/g, '$1'))
}

function resolveKey(lock, parentKey, dep) {
  let scope = parentKey
  while (true) {
    const key = scope ? `${scope}/${dep}` : dep
    if (lock.packages[key]) return key
    if (!scope) return undefined
    const parts = scope.split('/')
    const cut = parts.length >= 2 && parts[parts.length - 2].startsWith('@') ? 2 : 1
    scope = parts.slice(0, -cut).join('/')
  }
}

function splitSpec(spec) {
  const at = spec.lastIndexOf('@')
  return { name: spec.slice(0, at), version: spec.slice(at + 1) }
}

/**
 * Third-party packages installed for the given workspace folders ('' is the
 * root), following the workspace packages they depend on. Production
 * dependencies only, unless includeDev adds the selected workspaces' own
 * devDependencies. Returns Map<"name@version", entry> where entry is
 * { name, version, integrity, optional, dev, chains }: chains holds up to three
 * dependency paths that reach the package, optional is true when only optional
 * dependencies (often per-platform binaries) reach it, and dev is true when only
 * development dependencies reach it.
 */
export function productionPackages(lock, workspaceDirs, { includeDev = false } = {}) {
  const installed = new Map()
  const visited = new Map() // lock key -> weakest flags it was visited with
  const visitDeps = (parentKey, edges, chain) => {
    for (const [dep, flags] of edges) {
      const key = resolveKey(lock, parentKey, dep)
      if (!key) continue
      const { name, version } = splitSpec(lock.packages[key][0])
      if (version.startsWith('workspace:')) {
        visitWorkspace(version.slice('workspace:'.length), chain, flags)
        continue
      }
      const id = `${name}@${version}`
      if (!installed.has(id)) {
        installed.set(id, { name, version, integrity: lock.packages[key][3], ...flags, chains: [] })
      }
      const entry = installed.get(id)
      if (entry.chains.length < 3) entry.chains.push([...chain, id].join(' > '))
      entry.optional &&= flags.optional
      entry.dev &&= flags.dev
      // Revisit a package once a stronger (required or production) path reaches it.
      const seen = visited.get(key)
      if (seen && (seen.optional <= flags.optional && seen.dev <= flags.dev)) continue
      visited.set(key, { optional: entry.optional, dev: entry.dev })
      const meta = lock.packages[key][2] ?? {}
      visitDeps(key, edgesOf(meta, flags, false), [...chain, id])
    }
  }
  const visitWorkspace = (dir, chain, flags, withDev = false) => {
    const marker = `workspace:${dir}`
    const seen = visited.get(marker)
    if (seen && seen.optional <= flags.optional && seen.dev <= flags.dev) return
    visited.set(marker, flags)
    const manifest = lock.workspaces[dir]
    if (!manifest) throw new Error(`bun.lock has no workspace ${JSON.stringify(dir)}`)
    const scope = dir === '' ? '' : manifest.name
    visitDeps(scope, edgesOf(manifest, flags, withDev), [...chain, manifest.name ?? dir])
  }
  for (const dir of workspaceDirs) visitWorkspace(dir, [], { optional: false, dev: false }, includeDev)
  return installed
}

function edgesOf(manifest, flags, withDev) {
  return [
    ...Object.keys(manifest.dependencies ?? {}).map((dep) => [dep, flags]),
    ...Object.keys(manifest.optionalDependencies ?? {}).map((dep) => [dep, { ...flags, optional: true }]),
    ...(withDev ? Object.keys(manifest.devDependencies ?? {}).map((dep) => [dep, { ...flags, dev: true }]) : []),
  ]
}

/**
 * The installed package.json of name@version in Bun's isolated store
 * (node_modules/.bun/<name with + for />@<version>[+peer hash]/node_modules/<name>),
 * or undefined when it is not installed (an optional package for another platform).
 */
export function installedManifest(name, version, root = REPOSITORY_ROOT) {
  const store = join(root, 'node_modules', '.bun')
  const prefix = `${name.replace('/', '+')}@${version}`
  const folder = readdirSync(store).find((entry) => entry === prefix || entry.startsWith(`${prefix}+`))
  const file = folder && join(store, folder, 'node_modules', name, 'package.json')
  if (!file || !existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, 'utf8'))
}
