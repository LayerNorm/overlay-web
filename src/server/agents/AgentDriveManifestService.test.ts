import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentDriveDownloadCache } from './agent-drive-download-cache'
import { AgentDriveManifestService } from './AgentDriveManifestService'
import { AgentDriveMaterializer } from './AgentDriveMaterializer'
import { AgentDriveStorageReader } from './AgentDriveStorageReader'
import { createAgentDriveTokens } from './agent-drive-token'
import type { AgentDriveManifestRepository } from './AgentDriveManifestRepository'

const secret = 'drive-manifest-test-secret-at-least-32-bytes'
function fixture(now?: () => number, downloads?: AgentDriveDownloadCache) {
  const tokens = createAgentDriveTokens({ secret, now })
  const token = tokens.mint({ actorUserId: 'u', agentId: 'a', environmentId: 'e', bindingId: 'b', runId: 'r', sessionId: 's', scope: { kind: 'personal', workspaceId: 'w', ownerUserId: 'u' } }, (now ?? Date.now)() + 300000)
  const rows = [
    { _id: 'folder', name: 'Research', userId: 'u', workspaceId: 'w', type: 'folder', createdAt: 1, updatedAt: 2 },
    { _id: 'note', parentId: 'folder', name: 'note.md', userId: 'u', workspaceId: 'w', type: 'file', kind: 'note', content: 'Exact full note 🙂', createdAt: 1, updatedAt: 2 },
  ]
  let active = true; let reads = 0; let authorizeCount = 0; let contentReads = 0
  const commits: unknown[] = []
  const repository: AgentDriveManifestRepository = {
    async metadata(requestId, operation) { commits.push({ requestId, operation }); return { fileId: 'note', updatedAt: 3 } },
    async authorize() { authorizeCount++; if (!active) throw Error('DRIVE_RUN_UNAVAILABLE') },
    async page(cursor) {
      reads++
      const row = rows[cursor ? 1 : 0]!
      const { content, ...metadata } = row
      return { rows: [{ ...metadata, ...(content ? { driveInline: { sizeBytes: new TextEncoder().encode(content).length } } : {}) }],
        scope: { kind: 'personal', workspaceId: 'w', ownerUserId: 'u' }, viewer: { userId: 'u', role: 'member' }, nextCursor: cursor ? null : 'second' }
    },
    async file(fileId, revision) { const row = rows.find(row => row._id === fileId); if (!row || row.updatedAt !== revision) throw Error('DRIVE_SOURCE_CHANGED'); return row },
  }
  const materializer = new AgentDriveMaterializer(new AgentDriveStorageReader({
    async objectSize() { throw Error('unexpected object') }, async readObject() { throw Error('unexpected object') }, async convexSource() { throw Error('unexpected blob') },
    async inlineSource(source) { contentReads++; const row = rows.find(row => row._id === source.fileId); if (!row || row.updatedAt !== source.updatedAt) throw Error('DRIVE_SOURCE_CHANGED'); return row.content ?? '' },
  }))
  const service = new AgentDriveManifestService({downloads, secret, verifyToken: token => tokens.verify(token), repository: () => repository, materializer: () => materializer })
  return { service, token, rows, commits, repository, materializer, revoke() { active = false }, get reads() { return reads }, get contentReads() { return contentReads }, get authorizeCount() { return authorizeCount }, tokens }
}

test('paged manifest preserves hierarchy without retaining inline text and its download round-trips exact bytes', async () => {
  const f = fixture()
  const { entries } = await f.service.manifest(f.token)
  assert.equal(entries.length, 2)
  const item = entries.find(entry => entry.fileId === 'note')!
  assert.equal(item.path, 'Research/note.md')
  assert.equal(JSON.stringify(entries).includes('Exact full note'), false)
  assert.equal(JSON.stringify(entries).includes('storageId'), false)
  const { downloadMac, ...entry } = item
  assert.equal(downloadMac?.length, 43)
  assert.equal(new TextDecoder().decode(await f.service.download(f.token, { entry, downloadMac: downloadMac! })), f.rows[1]!.content)
  assert.equal(f.reads, 2)
  assert.ok(f.authorizeCount >= 6)
})

test('credential renewal preserves existing execution grants without accepting expired credentials or replaced attempts', async () => {
  let clock = 1000
  const f = fixture(() => clock)
  const item = (await f.service.manifest(f.token)).entries.find(entry => entry.fileId === 'note')!
  const { downloadMac, ...entry } = item
  const claims = f.tokens.verify(f.token)!
  clock += 300000
  assert.equal(f.tokens.verify(f.token), null)
  const renewed = f.tokens.mint(claims, clock + 120 * 60000)
  await assert.rejects(f.service.download(f.token, { entry, downloadMac: downloadMac! }), /DRIVE_UNAUTHORIZED/)
  assert.equal(new TextDecoder().decode(await f.service.download(renewed, { entry, downloadMac: downloadMac! })), f.rows[1]!.content)
  assert.deepEqual(await f.service.metadata(renewed, { action: 'metadata', requestId: 'renewed-metadata-001',
    operation: { kind: 'remove', entry: item, metadataMac: item.metadataMac! } }), { fileId: 'note', updatedAt: 3 })
  const replacement = f.tokens.mint({ ...claims, execution: { attemptId: 'replacement', generation: 2 } }, clock + 300000)
  await assert.rejects(f.service.download(replacement, { entry, downloadMac: downloadMac! }), /DRIVE_INVALID_DOWNLOAD/)
  await assert.rejects(f.service.metadata(replacement, { action: 'metadata', requestId: 'renewed-metadata-002',
    operation: { kind: 'remove', entry: item, metadataMac: item.metadataMac! } }), /DRIVE_INVALID_METADATA/)
  f.revoke()
  await assert.rejects(f.service.download(renewed, { entry, downloadMac: downloadMac! }), /DRIVE_RUN_UNAVAILABLE/)
})

test('download grants reject forged paths/hashes, another run, modified source bytes and revoked membership', async () => {
  const f = fixture()
  const item = (await f.service.manifest(f.token)).entries.find(entry => entry.fileId === 'note')!
  const { downloadMac, ...entry } = item
  const request = { entry, downloadMac: downloadMac! }
  await assert.rejects(f.service.download(f.token, { ...request, entry: { ...entry, path: 'forged.md' } }), /DRIVE_INVALID_DOWNLOAD/)
  const claims = f.tokens.verify(f.token)!
  const otherToken = f.tokens.mint({ ...claims, runId: 'another' }, claims.expiresAt)
  await assert.rejects(f.service.download(otherToken, request), /DRIVE_INVALID_DOWNLOAD/)
  f.rows[1]!.content = 'Other full note 🙂'
  await assert.rejects(f.service.download(f.token, request), /DRIVE_SOURCE_CHANGED/)
  f.revoke()
  await assert.rejects(f.service.download(f.token, request), /DRIVE_RUN_UNAVAILABLE/)
  await assert.rejects(f.service.manifest('forged'), /DRIVE_UNAUTHORIZED/)
})

test('revocation during pagination or materialization never returns a usable manifest', async () => {
  const f = fixture()
  const page = f.repository.page
  f.repository.page = async cursor => { const result = await page(cursor); if (cursor === null) f.revoke(); return result }
  await assert.rejects(f.service.manifest(f.token), /DRIVE_RUN_UNAVAILABLE/)
  const g = fixture()
  const manifest = g.materializer.manifest.bind(g.materializer)
  g.materializer.manifest = async candidates => { const result = await manifest(candidates); g.revoke(); return result }
  await assert.rejects(g.service.manifest(g.token), /DRIVE_RUN_UNAVAILABLE/)
})

test('non-progressing pagination and a cross-scope snapshot fail explicitly', async () => {
  const f = fixture()
  const page = f.repository.page
  f.repository.page = async cursor => ({ ...await page(cursor), nextCursor: 'repeated' })
  await assert.rejects(f.service.manifest(f.token), /DRIVE_SNAPSHOT_UNAVAILABLE/)
  const g = fixture()
  g.repository.page = async cursor => ({ ...await page(cursor), scope: { kind: 'workspace', workspaceId: 'w' } })
  await assert.rejects(g.service.manifest(g.token), /DRIVE_SCOPE_CHANGED/)
})

test('entry limits and revocation while downloading fail before publishing any result', async () => {
  const f = fixture()
  const page = await f.repository.page(null)
  f.repository.page = async () => ({ ...page, rows: Array.from({ length: 10001 }, () => page.rows[0]), nextCursor: null })
  await assert.rejects(f.service.manifest(f.token), /DRIVE_TOO_MANY_ENTRIES/)
  const g = fixture()
  const { downloadMac, ...entry } = (await g.service.manifest(g.token)).entries.find(entry => entry.fileId === 'note')!
  const read = g.materializer.read.bind(g.materializer)
  g.materializer.read = async (...args) => { const result = await read(...args); g.revoke(); return result }
  await assert.rejects(g.service.download(g.token, { entry, downloadMac: downloadMac! }), /DRIVE_RUN_UNAVAILABLE/)
})


test('metadata HTTP commits require an exact hydrated-entry grant bound to the current token', async () => {
  const { handleAgentDriveRequest } = await import('./agent-drive-http')
  const f = fixture()
  const entry = (await f.service.manifest(f.token)).entries.find(entry => entry.fileId === 'note')!
  const invoke = (operation: unknown, token = f.token) => handleAgentDriveRequest(new Request('https://preview.invalid/api/agent-drive', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'metadata', requestId: 'metadata-test-001', operation }),
  }), { enabled: () => true, service: () => f.service, limit: async () => null })
  const operation = { kind: 'remove', entry, metadataMac: entry.metadataMac }
  for (const patch of [{ fileId: 'other' }, { updatedAt: 3 }, { path: 'other.md' }, { kind: 'folder' }]) {
    assert.equal((await invoke({ ...operation, entry: { ...entry, ...patch } })).status, 403)
  }
  assert.equal((await invoke({ ...operation, metadataMac: entry.downloadMac })).status, 403)
  const claims = f.tokens.verify(f.token)!
  const another = f.tokens.mint({ ...claims, execution: { attemptId: 'new', generation: 2 } }, claims.expiresAt)
  assert.equal((await invoke(operation, another)).status, 403)
  assert.equal(f.commits.length, 0)
  const success = await invoke(operation)
  assert.equal(success.status, 200)
  assert.match(success.headers.get('cache-control')!, /no-store/)
  assert.deepEqual(await success.json(), { fileId: 'note', updatedAt: 3 })
  assert.deepEqual(f.commits, [{ requestId: 'metadata-test-001', operation: { kind: 'remove', fileId: 'note', path: 'Research/note.md', updatedAt: 2 } }])
  f.revoke()
  assert.equal((await invoke(operation)).status, 403)
  assert.equal(f.commits.length, 1)
})

test('metadata grants include folders but exclude unhydrated file entries', async () => {
  const f = fixture()
  f.materializer.manifest = async () => [{ fileId: 'folder', path: 'Research', kind: 'folder', updatedAt: 2 },
    { fileId: 'note', path: 'Research/large.bin', kind: 'file', updatedAt: 2, hydration: 'deferred', reason: 'file_limit', sizeBytes: 17000000 }]
  const entries = (await f.service.manifest(f.token)).entries
  assert.equal(entries[0]?.metadataMac?.length, 43)
  assert.equal(entries[1]?.metadataMac, undefined)
})


test('cached ranges still recheck current authority, revision and source before reuse', async () => {
  const f = fixture(undefined, new AgentDriveDownloadCache())
  const item = (await f.service.manifest(f.token)).entries.find(entry => entry.fileId === 'note')!
  const {downloadMac, ...entry} = item
  assert.ok(downloadMac)
  const first = await f.service.download(f.token, {entry, downloadMac})
  const before = f.authorizeCount, contentReads = f.contentReads
  assert.deepEqual(await f.service.download(f.token, {entry, downloadMac}), first)
  assert.ok(f.authorizeCount > before)
  assert.equal(f.contentReads, contentReads, 'Verified bytes are reused across range requests')
  f.rows[1]!.updatedAt = 3
  await assert.rejects(f.service.download(f.token, {entry, downloadMac}), /DRIVE_SOURCE_CHANGED|DRIVE_FILE_UNAVAILABLE/)
  f.rows[1]!.updatedAt = 2
  f.revoke()
  await assert.rejects(f.service.download(f.token, {entry, downloadMac}), /DRIVE_RUN_UNAVAILABLE/)
})
