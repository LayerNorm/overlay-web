#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')
// The root depends on `mintlify`, which installs its own @mintlify/cli beside it
// (Bun's isolated store: node_modules/.bun/mintlify@…/node_modules/{mintlify,@mintlify/cli}).
const mintlifyDir = realpathSync(path.dirname(createRequire(path.join(root, 'package.json')).resolve('mintlify/package.json')))
const mintCli = path.join(mintlifyDir, '..', '@mintlify', 'cli', 'bin', 'start.js')
const jsYamlCompat = path.join(root, 'scripts/ci/mint-js-yaml-compat.mjs')
const args = process.argv.slice(2)

const candidateNodes = [
  process.env.MINTLIFY_NODE,
  process.execPath,
  '/opt/homebrew/opt/node@22/bin/node',
  '/opt/homebrew/opt/node@20/bin/node',
  '/usr/local/opt/node@22/bin/node',
  '/usr/local/opt/node@20/bin/node',
].filter(Boolean)

const node = await findSupportedNode(candidateNodes)
if (!node) {
  console.error('Mintlify requires Node <25. Install Node 20 or 22, or set MINTLIFY_NODE to a supported node binary.')
  process.exit(1)
}

const result = spawnSync(node, ['--no-deprecation', '--import', jsYamlCompat, mintCli, ...args], {
  cwd: process.cwd(),
  env: { ...process.env, MINTLIFY_PACKAGE_NAME: 'mint' },
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)

async function findSupportedNode(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    if (!(await fileExists(candidate))) continue
    const version = spawnSync(candidate, ['-p', 'process.versions.node'], { encoding: 'utf8' })
    const major = Number(version.stdout.trim().split('.')[0])
    if (Number.isFinite(major) && major < 25) return candidate
  }
  return undefined
}

async function fileExists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}
