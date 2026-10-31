#!/usr/bin/env node
// Copy exact installs into checkout to preserve relative workspace symlinks.
// Namespace isolates each job's snapshot; only main can commit cache updates.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function dependencyInputs(root) {
  const files = ['package-lock.json', 'package.json', '.npmrc',
    '.github/actions/ci-dependencies/action.yml', 'scripts/ci/dependency-cache.mjs']
  for (const parent of ['packages', 'apps']) {
    for (const child of fs.readdirSync(path.join(root, parent)).sort()) {
      const manifest = `${parent}/${child}/package.json`
      if (fs.existsSync(path.join(root, manifest))) files.push(manifest)
    }
  }
  return files
}

export function dependencyKey(root, runtime) {
  const hash = createHash('sha256').update(JSON.stringify(runtime))
  for (const file of dependencyInputs(root)) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0')
  return hash.digest('hex')
}

const copyFlags = () => process.platform === 'linux' ? ['-a', '--reflink=auto'] : ['-a']

export function restoreTree(root, entry, paths) {
  for (const item of paths) {
    const source = path.join(entry, item)
    const destination = path.join(root, item)
    fs.rmSync(destination, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    execFileSync('cp', [...copyFlags(), source, destination])
  }
}

export function pruneEntries(cacheRoot, currentKey, limit = 2) {
  if (!fs.existsSync(cacheRoot)) return
  const keys = []
  for (const name of fs.readdirSync(cacheRoot)) {
    const entry = path.join(cacheRoot, name)
    if (name.startsWith('.install-')) fs.rmSync(entry, { recursive: true, force: true })
    else if (/^[a-f0-9]{64}$/.test(name) && name !== currentKey) keys.push({ name, modified: fs.statSync(entry).mtimeMs })
  }
  keys.sort((a, b) => b.modified - a.modified)
  for (const { name } of keys.slice(limit - 1)) fs.rmSync(path.join(cacheRoot, name), { recursive: true, force: true })
}

export function install(root, cacheRoot) {
  const npm = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
  const runtime = { node: process.version, npm, platform: process.platform, arch: process.arch }
  const key = dependencyKey(root, runtime)
  const entry = path.join(cacheRoot, key)
  // Reserve one slot for the current tree; Node 22/24 need at most two warm
  // installs. Arbitrary keyed directories have no provider-level eviction.
  pruneEntries(cacheRoot, key)
  const allowedPaths = ['node_modules', ...dependencyInputs(root).filter(item => /^(packages|apps)\//.test(item))
    .map(item => item.replace(/package.json$/, 'node_modules'))]
  const marker = path.join(entry, 'complete.json')
  let saved
  try { saved = JSON.parse(fs.readFileSync(marker, 'utf8')) } catch { /* cold or incomplete */ }
  if (saved?.key === key && Array.isArray(saved.paths) && saved.paths.includes('node_modules') &&
      saved.paths.every(item => allowedPaths.includes(item) &&
        fs.existsSync(path.join(entry, item)))) {
    restoreTree(root, entry, saved.paths)
    const now = new Date()
    fs.utimesSync(entry, now, now)
    console.log(`Dependency volume hit (${process.version}, npm ${npm}).`)
    return 'hit'
  }
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' })
  const paths = ['node_modules', ...dependencyInputs(root).filter(item => /^(packages|apps)\//.test(item))
    .map(item => item.replace(/package.json$/, 'node_modules'))]
    .filter(item => fs.existsSync(path.join(root, item)))
  fs.mkdirSync(cacheRoot, { recursive: true })
  const staging = fs.mkdtempSync(path.join(cacheRoot, '.install-'))
  try {
    for (const item of paths) {
      fs.mkdirSync(path.dirname(path.join(staging, item)), { recursive: true })
      execFileSync('cp', [...copyFlags(), path.join(root, item), path.join(staging, item)])
    }
    fs.writeFileSync(path.join(staging, 'complete.json'), JSON.stringify({ key, paths }))
    fs.rmSync(entry, { recursive: true, force: true })
    fs.renameSync(staging, entry)
  } finally { fs.rmSync(staging, { recursive: true, force: true }) }
  console.log(`Dependency volume miss (${process.version}, npm ${npm}); saved complete locked installation.`)
  return 'miss'
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  install(process.cwd(), path.join(os.homedir(), '.cache/overlay-ci-dependencies'))
}
