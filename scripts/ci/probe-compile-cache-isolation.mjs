#!/usr/bin/env node
// Opt-in safety experiment; generated fixtures and bytecode stay outside the repo.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const directory = mkdtempSync(path.join(tmpdir(), 'overlay-isolation-'))
try {
  writeFileSync(path.join(directory, 'state.mjs'), 'export const state = { count: 0 }\n')
  const files = Array.from({ length: 3 }, (_, index) => path.join(directory, `${index}.test.mjs`))
  for (const file of files) {
    writeFileSync(file, `import test from 'node:test'
import assert from 'node:assert/strict'
import { state } from './state.mjs'
test('environment, global and module state stay isolated', () => {
  assert.equal(globalThis.__overlayCompileCacheProbe, undefined)
  assert.equal(process.env.OVERLAY_COMPILE_CACHE_PROBE, undefined)
  assert.equal(state.count, 0)
  globalThis.__overlayCompileCacheProbe = true
  process.env.OVERLAY_COMPILE_CACHE_PROBE = 'dirty'
  state.count++
})\n`)
  }
  const env = { ...process.env, NODE_COMPILE_CACHE: path.join(directory, 'bytecode') }
  delete env.OVERLAY_COMPILE_CACHE_PROBE
  const orders = [files, [...files].reverse(), [files[1], files[2], files[0]]]
  for (const order of orders) {
    const isolated = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...order], {
      env, encoding: 'utf8', timeout: 30_000,
    })
    assert.equal(isolated.status, 0, isolated.error?.message ?? `${isolated.stdout}\n${isolated.stderr}`)
    assert.match(isolated.stdout, /# tests 3\b/)
    assert.match(isolated.stdout, /# pass 3\b/)
    const shared = spawnSync(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=tap', ...order], {
      env, encoding: 'utf8', timeout: 30_000,
    })
    assert.equal(shared.error, undefined)
    assert.notEqual(shared.status, 0, 'The negative control must detect leaked state')
    assert.match(shared.stdout, /ERR_ASSERTION/)
    assert.match(shared.stdout, /# tests 3\b/)
    assert.match(shared.stdout, /# fail 2\b/)
  }
  console.log(`Node ${process.version}: compile-cache isolation passed in three orders; all shared-state negative controls failed as expected.`)
} finally {
  rmSync(directory, { recursive: true, force: true })
}
