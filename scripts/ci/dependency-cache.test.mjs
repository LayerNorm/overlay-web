import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { dependencyKey, install, pruneEntries } from './dependency-cache.mjs'

test('dependency trees are invalidated by runtime, manifests, lockfile and installation policy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-cache-contract-'))
  try {
    for (const dir of ['packages/a', 'apps/admin', '.github/actions/ci-dependencies', 'scripts/ci']) fs.mkdirSync(path.join(root, dir), { recursive: true })
    const inputs = ['package.json', 'package-lock.json', '.npmrc', 'packages/a/package.json', 'apps/admin/package.json', '.github/actions/ci-dependencies/action.yml', 'scripts/ci/dependency-cache.mjs']
    for (const input of inputs) fs.writeFileSync(path.join(root, input), '{}')
    const runtime = { node: 'v22.1.0', npm: '11.11.0', arch: 'x64', platform: 'linux' }
    const key = dependencyKey(root, runtime)
    for (const input of inputs) {
      fs.writeFileSync(path.join(root, input), '{"changed":true}')
      assert.notEqual(dependencyKey(root, runtime), key, input)
      fs.writeFileSync(path.join(root, input), '{}')
    }
    for (const field of Object.keys(runtime)) assert.notEqual(dependencyKey(root, { ...runtime, [field]: 'other' }), key, field)
    assert.equal(dependencyKey(root, runtime), key)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('warm reuse preserves workspace links; interrupted and incompatible entries reinstall', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-cache-install-'))
  const oldPath = process.env.PATH
  try {
    for (const dir of ['packages/a', 'apps/admin', '.github/actions/ci-dependencies', 'scripts/ci', 'bin']) fs.mkdirSync(path.join(root, dir), { recursive: true })
    for (const input of ['package.json', 'package-lock.json', '.npmrc', 'packages/a/package.json', 'apps/admin/package.json', '.github/actions/ci-dependencies/action.yml', 'scripts/ci/dependency-cache.mjs']) fs.writeFileSync(path.join(root, input), '{}')
    const npm = path.join(root, 'bin/npm')
    fs.writeFileSync(npm, `#!${process.execPath}\nconst fs = require('node:fs');\nif (process.argv[2] === '--version') console.log('11.11.0');\nelse {\nif (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['ci','--ignore-scripts','--no-audit','--no-fund'])) process.exit(7);\nfs.appendFileSync('installs','1');\nfs.rmSync('node_modules',{recursive:true,force:true});\nfs.mkdirSync('node_modules/@overlay',{recursive:true});\nfs.symlinkSync('../../packages/a','node_modules/@overlay/a');\nfs.mkdirSync('apps/admin/node_modules',{recursive:true});\nfs.writeFileSync('apps/admin/node_modules/fixture','locked');\n}\n`)
    fs.chmodSync(npm, 0o755)
    process.env.PATH = `${path.join(root, 'bin')}${path.delimiter}${oldPath}`
    const cache = path.join(root, 'volume')
    const previous = process.cwd()
    process.chdir(root)
    try {
      assert.equal(install(root, cache), 'miss')
      fs.rmSync(path.join(root, 'node_modules'), { recursive: true })
      assert.equal(install(root, cache), 'hit')
      assert.equal(fs.readFileSync('installs', 'utf8'), '1')
      assert.equal(fs.readFileSync('node_modules/@overlay/a/package.json', 'utf8'), '{}')
      assert.equal(fs.readFileSync('apps/admin/node_modules/fixture', 'utf8'), 'locked')
      const [key] = fs.readdirSync(cache)
      fs.rmSync(path.join(cache, key, 'complete.json'))
      fs.rmSync('node_modules', { recursive: true })
      assert.equal(install(root, cache), 'miss')
      assert.equal(fs.readFileSync('installs', 'utf8'), '11')
      fs.writeFileSync('package-lock.json', '{"different":true}')
      assert.equal(install(root, cache), 'miss')
      assert.equal(fs.readFileSync('installs', 'utf8'), '111')
    } finally { process.chdir(previous) }
  } finally {
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    fs.rmSync(root, { recursive: true, force: true })
  }
})


test('retention removes stale owned trees and interrupted staging without touching other files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-cache-prune-'))
  try {
    for (const name of ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), '.install-interrupted', 'unrelated']) fs.mkdirSync(path.join(root, name))
    pruneEntries(root, 'c'.repeat(64))
    assert.ok(fs.existsSync(path.join(root, 'c'.repeat(64))))
    assert.ok(fs.existsSync(path.join(root, 'unrelated')))
    assert.equal(fs.readdirSync(root).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 2)
    assert.equal(fs.existsSync(path.join(root, '.install-interrupted')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
