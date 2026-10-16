import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SqliteDriveSyncState } from './drive-sync-state'

const scope = { kind: 'workspace' as const, workspaceId: 'workspace' }
const entry = { fileId: 'folder', path: 'Empty', kind: 'folder' as const, updatedAt: 1, metadataMac: 'a'.repeat(43) }
const local = { path: 'Empty', identity: { device: '1', inode: '123', birthtimeNs: '999' } }

test('baseline, saved links and pending hydration survive reopening without mixing scopes', () => {
  const root = mkdtempSync(join(tmpdir(), 'drive-state-')), cache = join(root, 'drive'), path = join(root, 'state.sqlite')
  mkdirSync(cache)
  let state = new SqliteDriveSyncState(path, cache, scope)
  try {
    const value = { phase: 'hydrating' as const, initialized: true, baseline: [{ entry, local }],
      turn: { runId: 'run', saved: [{ fileId: entry.fileId, path: entry.path, kind: entry.kind }] }, entry, path: entry.path, prior: local }
    state.write(value)
    state.close()
    assert.throws(() => new SqliteDriveSyncState(path, cache, { kind: 'workspace', workspaceId: 'other' }), /SCOPE_CHANGED/)
    state = new SqliteDriveSyncState(path, cache, scope)
    assert.deepEqual(state.read(), value)
    assert.throws(() => state.write({ phase: 'idle', initialized: true, turn: null,
      baseline: [{ entry, local }, { entry: { ...entry, fileId: 'other' }, local: { ...local, path: 'empty' } }] }), /AMBIGUOUS_BASELINE/)
    assert.deepEqual(state.read(), value)
  } finally { state.close(); rmSync(root, { recursive: true, force: true }) }
})

test('private sync state cannot be placed inside the scanned drive or through a directory alias', () => {
  const root = mkdtempSync(join(tmpdir(), 'drive-state-')), cache = join(root, 'drive')
  mkdirSync(cache)
  try {
    assert.throws(() => new SqliteDriveSyncState(join(cache, 'state.sqlite'), cache, scope), /STATE_INSIDE_CACHE/)
    const alias = join(root, 'alias')
    symlinkSync(cache, alias, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => new SqliteDriveSyncState(join(alias, 'state.sqlite'), cache, scope), /STATE_INSIDE_CACHE/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
