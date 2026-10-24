import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import type {DriveManifestEntry} from '@layernorm/overlay-agent-bridge-protocol'
import {AgentDriveCache} from './drive-cache.js'
import {AgentDriveClient} from './drive-client.js'
import {SqliteDriveJournal} from './drive-journal.js'
import {SqliteDriveSyncState} from './drive-sync-state.js'
import {AgentDriveSynchronizer} from './drive-sync.js'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

test('a settled folder move preserves later local child edits when remote children change or disappear', async () => {
  for (const deleted of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'drive-receipt-race-'))
    const cache = await AgentDriveCache.create(directory, 'cache')
    const scope = {kind: 'personal' as const, workspaceId: 'workspace', ownerUserId: 'owner'}
    const journal = new SqliteDriveJournal(join(directory, 'private', 'writes.sqlite'),
      {environmentId: 'environment', runId: 'run', sessionId: 'session', scope})
    const state = new SqliteDriveSyncState(join(directory, 'private', 'baseline.sqlite'), cache.root, scope)
    try {
      await mkdir(join(cache.root, 'old'))
      await writeFile(join(cache.root, 'old', 'child.md'), 'original')
      const inventory = await cache.inventory()
      const folder = inventory.find(row => row.path === 'old')!, child = inventory.find(row => row.path === 'old/child.md')!
      const folderEntry = {fileId: 'folder', path: 'old', kind: 'folder' as const, updatedAt: 1, metadataMac: 'a'.repeat(43)}
      const childEntry = {fileId: 'child', path: 'old/child.md', kind: 'file' as const, hydration: 'ready' as const,
        updatedAt: 1, sha256: hash('original'), sizeBytes: 8, metadataMac: 'a'.repeat(43), downloadMac: 'b'.repeat(43)}
      const request = {action: 'metadata' as const, requestId: 'settled-folder-move', operation: {kind: 'move' as const,
        entry: {fileId: 'folder', path: 'old', kind: 'folder' as const, updatedAt: 1}, metadataMac: 'a'.repeat(43), name: 'new'}}
      state.write({phase: 'writing', initialized: true, turn: {runId: 'run', saved: []},
        baseline: [{entry: folderEntry, local: {path: folder.path, identity: folder.identity}},
          {entry: childEntry, local: {path: child.path, identity: child.identity}}],
        operation: {kind: 'metadata', request, target: {path: 'new', identity: folder.identity}}})
      journal.prepareMetadata(request)
      journal.advanceMetadata(request.requestId, {fileId: 'folder', updatedAt: 2})
      await rename(join(cache.root, 'old'), join(cache.root, 'new'))
      await writeFile(join(cache.root, 'new', 'child.md'), 'keep my later local edit')
      const entries: DriveManifestEntry[] = deleted ? [] : [{...folderEntry, path: 'new', updatedAt: 2},
        {...childEntry, path: 'new/child.md', updatedAt: 3, sha256: hash('remote edit'), sizeBytes: 11}]
      const client = new AgentDriveClient({apiUrl: 'https://preview.invalid/api/agent-drive',
        credentials: async () => ({protocolVersion: 1, scope, expiresAt: Date.now() + 60000,
          token: `ovdrive_${'x'.repeat(32)}.${'y'.repeat(43)}`}),
        fetch: async () => new Response([{type: 'manifest', version: 1}, ...entries.map(entry => ({type: 'entry', entry})),
          {type: 'complete', entries: entries.length}].map(frame => JSON.stringify(frame) + '\n').join(''))})
      const sync = new AgentDriveSynchronizer({runId: 'run', cache, client, journal, state})
      await sync.settlePreviousWrite()
      await sync.settlePreviousWrite()
      assert.equal(state.read().phase, 'idle')
      assert.equal(state.read().baseline.some(row => row.local?.path.endsWith('child.md')), false)
      assert.equal(await readFile(join(cache.root, 'new', 'child.md'), 'utf8'), 'keep my later local edit')
    } finally {journal.close(); state.close(); await rm(directory, {recursive: true, force: true})}
  }
})
