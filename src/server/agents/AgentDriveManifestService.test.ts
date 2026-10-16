import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentDriveManifestService } from './AgentDriveManifestService'
import { AgentDriveMaterializer } from './AgentDriveMaterializer'
import { AgentDriveStorageReader } from './AgentDriveStorageReader'
import { createAgentDriveTokens } from './agent-drive-token'
import type { AgentDriveManifestRepository } from './AgentDriveManifestRepository'

const secret = 'drive-manifest-test-secret-at-least-32-bytes'
function fixture() {
  const tokens = createAgentDriveTokens({ secret })
  const token = tokens.mint({ actorUserId: 'u', agentId: 'a', environmentId: 'e', bindingId: 'b', runId: 'r', sessionId: 's', scope: { kind: 'personal', workspaceId: 'w', ownerUserId: 'u' } }, Date.now() + 300000)
  const rows = [
    { _id: 'folder', name: 'Research', userId: 'u', workspaceId: 'w', type: 'folder', createdAt: 1, updatedAt: 2 },
    { _id: 'note', parentId: 'folder', name: 'note.md', userId: 'u', workspaceId: 'w', type: 'file', kind: 'note', content: 'Exact full note 🙂', createdAt: 1, updatedAt: 2 },
  ]
  let active = true; let reads = 0; let authorizeCount = 0
  const repository: AgentDriveManifestRepository = {
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
    async inlineSource(source) { const row = rows.find(row => row._id === source.fileId); if (!row || row.updatedAt !== source.updatedAt) throw Error('DRIVE_SOURCE_CHANGED'); return row.content ?? '' },
  }))
  const service = new AgentDriveManifestService({ secret, verifyToken: token => tokens.verify(token), repository: () => repository, materializer: () => materializer })
  return { service, token, rows, repository, materializer, revoke() { active = false }, get reads() { return reads }, get authorizeCount() { return authorizeCount }, tokens }
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
