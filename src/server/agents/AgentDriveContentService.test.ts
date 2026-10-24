import 'server-only'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { AgentDriveContentService, type DriveUploadRecord, type DriveContentResult } from './AgentDriveContentService'
import { createAgentDriveTokens } from './agent-drive-token'
import { driveMetadataMac } from './agent-drive-entry-grants'

function fixture(bytes = new TextEncoder().encode('original text'), mimeType = 'text/plain') {
  const secret = 'drive-content-unit-test-secret-32-bytes'
  const tokens = createAgentDriveTokens({ secret })
  const token = tokens.mint({ actorUserId: 'user', agentId: 'agent', environmentId: 'environment', bindingId: 'binding', runId: 'run', sessionId: 'session',
    scope: { kind: 'personal', workspaceId: 'workspace', ownerUserId: 'user' } }, Date.now() + 60000)
  const claims = tokens.verify(token)
  if (!claims) throw Error('Expected token')
  const uploadId = '45e2a73c-0b76-4ded-a655-6233689eaa61'
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const record: DriveUploadRecord = { uploadId, ownerUserId: 'user', name: 'report.txt', operation: { kind: 'create', name: 'report.txt' },
    sha256, sizeBytes: bytes.length, mimeType, stagingKey: 'staging-only', finalKey: 'immutable-final', expiresAt: Date.now() + 60000, state: { kind: 'pending' } }
  let source = bytes
  let live = true
  let afterRead = () => {}
  let afterSeal = () => {}
  const seals: Uint8Array[] = []
  const urls: string[] = []
  const commits: unknown[] = []
  let registrations = 0
  const result: DriveContentResult = { fileId: 'file', updatedAt: 100, name: 'report.txt', conflict: false, objectStored: true, sha256, sizeBytes: bytes.length }
  const service = new AgentDriveContentService({ secret, verifyToken: tokens.verify, repository: () => ({
    async authorize() { if (!live) throw Error('DRIVE_RUN_UNAVAILABLE') },
    async intent() { registrations++; return record }, async read() { return record },
    async commit(input) { commits.push(input); record.state = { kind: 'committed', result }; return result },
  }), storage: {
    async checkBudget() {},
    async uploadUrl(key, _mime, size, digest, ttl) { urls.push(key); assert.equal(size, bytes.length); assert.equal(digest, sha256); assert.ok(ttl <= 120); return 'https://object.test/staging' },
    async read(key, maximumBytes) { assert.equal(key, record.stagingKey); assert.ok(maximumBytes >= Math.max(1, source.length)); const read = source.slice(); afterRead(); return read },
    async seal(key, value) { assert.equal(key, record.finalKey); seals.push(value.slice()); afterSeal() },
  } })
  const intent = { action: 'upload' as const, requestId: 'unit-content-request', operation: { kind: 'create' as const, name: 'report.txt' }, sha256, sizeBytes: bytes.length, mimeType }
  return { service, token, claims, secret, record, result, intent, seals, urls, commits, registrations: () => registrations,
    source: (value: Uint8Array) => { source = value }, revoke: () => { live = false },
    afterRead: (fn: () => void) => { afterRead = fn }, afterSeal: (fn: () => void) => { afterSeal = fn } }
}

test('upload grants target staging only and return no final-object identity', async () => {
  const f = fixture()
  const grant = await f.service.intent(f.token, f.intent)
  assert.equal(grant.state, 'pending')
  assert.deepEqual(f.urls, ['staging-only'])
  assert.equal(JSON.stringify(grant).includes(f.record.finalKey), false)
  assert.equal(JSON.stringify(grant).includes(f.token), false)
})

test('full size and SHA-256 are verified before sealing or committing', async () => {
  for (const changed of [new Uint8Array([1]), new TextEncoder().encode('modified text')]) {
    const f = fixture(); f.source(changed)
    await assert.rejects(f.service.commit(f.token, { action: 'commit', uploadId: f.record.uploadId }), /DRIVE_UPLOAD_CHANGED/)
    assert.equal(f.seals.length, 0); assert.equal(f.commits.length, 0)
  }
})

test('revocation during a read or seal prevents publishing a file pointer', async () => {
  for (const boundary of ['read', 'seal']) {
    const f = fixture()
    if (boundary === 'read') f.afterRead(f.revoke)
    else f.afterSeal(f.revoke)
    await assert.rejects(f.service.commit(f.token, { action: 'commit', uploadId: f.record.uploadId }), /DRIVE_RUN_UNAVAILABLE/)
    assert.equal(f.commits.length, 0)
    assert.equal(f.seals.length, boundary === 'read' ? 0 : 1)
  }
})

test('empty files use a bounded read, and malformed UTF-8 text cannot become a truncated file', async () => {
  const empty = fixture(new Uint8Array())
  assert.deepEqual(await empty.service.commit(empty.token, { action: 'commit', uploadId: empty.record.uploadId }), empty.result)
  assert.deepEqual(empty.commits, [{ uploadId: empty.record.uploadId, verifiedSha256: empty.record.sha256, verifiedSizeBytes: 0, textPrefix: '' }])
  const invalid = fixture(new Uint8Array([255]), 'text/plain')
  await assert.rejects(invalid.service.commit(invalid.token, { action: 'commit', uploadId: invalid.record.uploadId }), /DRIVE_INVALID_UPLOAD/)
  assert.equal(invalid.seals.length, 0)
  const binary = fixture(new Uint8Array([255]), 'application/octet-stream')
  await binary.service.commit(binary.token, { action: 'commit', uploadId: binary.record.uploadId })
  assert.equal('textPrefix' in Object(binary.commits[0]), false)
})

test('replace grants bind the hydrated entry and reject changed revisions before registering an upload', async () => {
  const f = fixture()
  const entry = { fileId: 'file', path: 'report.txt', kind: 'file' as const, updatedAt: 1 }
  const metadataMac = driveMetadataMac(f.secret, f.claims, entry).toString('base64url')
  assert.equal(driveMetadataMac(f.secret, f.claims, { updatedAt: entry.updatedAt, kind: entry.kind,
    path: entry.path, fileId: entry.fileId }).toString('base64url'), metadataMac)
  await assert.rejects(f.service.intent(f.token, { ...f.intent,
    operation: { kind: 'replace', entry: { ...entry, updatedAt: 2 }, metadataMac } }), /DRIVE_INVALID_METADATA/)
  assert.equal(f.registrations(), 0)
  await f.service.intent(f.token, { ...f.intent, operation: { kind: 'replace', entry, metadataMac } })
  assert.equal(f.registrations(), 1)
})
