import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function scan(t, files, exports = { '.': './src/index.ts' }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'overlay-package-aliases-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'scripts/ci'), { recursive: true })
  copyFileSync(path.join(repo, 'scripts/ci/enforce-mobile-package-aliases.mjs'), path.join(root, 'scripts/ci/check.mjs'))
  symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  for (const name of ['api-client', 'app-core', 'chat-core', 'workspace-contracts']) {
    const dir = path.join(root, 'packages', `overlay-${name}`)
    mkdirSync(path.join(dir, 'src'), { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ exports: name === 'api-client' ? exports : {} }))
  }
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(path.join(root, 'packages/overlay-api-client/src', name), source)
  }
  return spawnSync(process.execPath, [path.join(root, 'scripts/ci/check.mjs')], { encoding: 'utf8' })
}

test('accepts alias-free transitive imports', t => {
  const result = scan(t, { 'index.ts': "export * from './nested'", 'nested.ts': 'export const value = 1' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /2 reachable modules, 0 @\/ leaks/)
})

test('accepts empty exports', t => {
  const result = scan(t, {}, {})
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /0 reachable modules, 0 @\/ leaks/)
})

test('rejects aliases in transitive runtime and type-only imports', t => {
  const result = scan(t, {
    'index.ts': "export * from './nested'",
    'nested.ts': "import { value } from '@/shared/value'; import type { User } from '@/shared/user'",
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /nested.ts: @\/shared\/value/)
  assert.match(result.stderr, /nested.ts: @\/shared\/user/)
})

test('fails closed on unresolved local imports', t => {
  const result = scan(t, { 'index.ts': "export * from './missing'" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unresolved \.\/missing/)
})
