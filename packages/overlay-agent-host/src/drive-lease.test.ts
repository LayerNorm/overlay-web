import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import test from 'node:test'
import { AgentDriveLease } from './drive-lease'

const scope = { kind: 'workspace' as const, workspaceId: 'workspace' }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'drive-lease-')), cache = join(root, 'cache'), path = join(root, 'private', 'lease.sqlite')
  mkdirSync(cache)
  return { root, path, cache, clean: () => rmSync(root, { recursive: true, force: true }) }
}

test('a held cache lease excludes another connection and releases explicitly without changing scope', () => {
  const f = fixture()
  try {
    const first = AgentDriveLease.acquire(f.path, f.cache, scope)
    assert.equal(statSync(f.path).mode & 0o777, 0o600)
    assert.throws(() => AgentDriveLease.acquire(f.path, f.cache, scope), /DRIVE_CACHE_BUSY/)
    first.release()
    first.release()
    assert.throws(() => AgentDriveLease.acquire(f.path, f.cache, { kind: 'workspace', workspaceId: 'other' }), /SCOPE_CHANGED/)
    const next = AgentDriveLease.acquire(f.path, f.cache, scope)
    next.release()
    const otherCache = join(f.root, 'other-cache')
    mkdirSync(otherCache)
    assert.throws(() => AgentDriveLease.acquire(f.path, otherCache, scope), /SCOPE_CHANGED/)
  } finally { f.clean() }
})

test('lease database must remain outside the agent cache, including parent-directory aliases', () => {
  const f = fixture()
  try {
    assert.throws(() => AgentDriveLease.acquire(join(f.cache, 'lease.sqlite'), f.cache, scope), /INSIDE_CACHE/)
    const alias = join(f.root, 'alias')
    symlinkSync(f.cache, alias, 'dir')
    assert.throws(() => AgentDriveLease.acquire(join(alias, 'lease.sqlite'), f.cache, scope), /INSIDE_CACHE/)
  } finally { f.clean() }
})

test('process loss releases the OS cache lease without TTL takeover or deleting its identity', { timeout: 15000 }, async () => {
  const f = fixture()
  const childSource = join(f.root, 'holder.mjs')
  const modulePath = new URL('./drive-lease.ts', import.meta.url).href
  writeFileSync(childSource, `import { AgentDriveLease } from ${JSON.stringify(modulePath)};
    AgentDriveLease.acquire(${JSON.stringify(f.path)}, ${JSON.stringify(f.cache)}, ${JSON.stringify(scope)});
    process.stdout.write('lease-held'); setInterval(()=>{},1000);`)
  const child = spawn(process.execPath, ['--import', 'tsx', childSource], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const ready = await Promise.race([
      once(child.stdout, 'data').then(([chunk]) => String(chunk)),
      once(child, 'exit').then(([code]) => { throw Error(`Lease test child exited ${code}`) }),
    ])
    assert.equal(ready, 'lease-held')
    assert.throws(() => AgentDriveLease.acquire(f.path, f.cache, scope), /DRIVE_CACHE_BUSY/)
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    const recovered = AgentDriveLease.acquire(f.path, f.cache, scope)
    recovered.release()
    assert.throws(() => AgentDriveLease.acquire(f.path, f.cache, { kind: 'workspace', workspaceId: 'other' }), /SCOPE_CHANGED/)
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited }
    f.clean()
  }
})
