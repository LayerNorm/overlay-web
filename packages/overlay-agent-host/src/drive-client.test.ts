import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { AgentDriveClient, DriveRequestError } from './drive-client'
import type { DriveCredentialsResponse, DriveReadyEntry } from '@layernorm/overlay-agent-bridge-protocol'

const mac = 'a'.repeat(43)
const emptyHash = createHash('sha256').update('').digest('hex')
const scope = { kind: 'personal' as const, workspaceId: 'workspace', ownerUserId: 'owner' }
function credential(sequence = 1, expiresAt = 10_000_000): DriveCredentialsResponse {
  return { protocolVersion: 1, token: `ovdrive_${'x'.repeat(32)}${sequence}.${'y'.repeat(43)}`, expiresAt, scope }
}
const folder = { fileId: 'folder', path: 'Research', kind: 'folder', updatedAt: 1, metadataMac: mac }
const ndjson = (entries: unknown[]) => new Response([
  { type: 'manifest', version: 1 }, ...entries.map(entry => ({ type: 'entry', entry })), { type: 'complete', entries: entries.length },
].map(frame => JSON.stringify(frame) + '\n').join(''))

test('parallel drive requests share credential renewal and retry only unauthorized requests once', async () => {
  let renewals = 0, requests = 0
  const client = new AgentDriveClient({ apiUrl: 'https://preview.invalid/api/agent-drive', now: () => 1000,
    credentials: async () => credential(++renewals), fetch: async (_url, init) => {
      requests++
      assert.equal(init?.redirect, 'error')
      assert.equal(init?.credentials, 'omit')
      if (new Headers(init?.headers).get('authorization') === `Bearer ${credential(1).token}`) return Response.json({ error: 'DRIVE_UNAUTHORIZED' }, { status: 401 })
      return ndjson([folder])
    } })
  const results = await Promise.all([client.manifest(), client.manifest(), client.manifest()])
  assert.equal(renewals, 2)
  assert.equal(requests, 6)
  assert.ok(results.every(result => result[0]?.path === 'Research'))
})

test('short remaining lifetimes do not renew every request and scope changes fail closed', async () => {
  let clock = 1000, renewals = 0
  const client = new AgentDriveClient({ apiUrl: 'https://preview.invalid/api/agent-drive', now: () => clock,
    credentials: async () => ({ ...credential(++renewals, clock + 20000), scope: renewals > 2 ? { kind: 'workspace', workspaceId: 'workspace' } : scope }),
    fetch: async () => ndjson([folder]) })
  for (let i = 0; i < 3; i++) await client.manifest()
  assert.equal(renewals, 1)
  clock += 11000
  await client.manifest()
  assert.equal(renewals, 2)
  clock += 11000
  await assert.rejects(client.manifest(), /DRIVE_SCOPE_CHANGED/)
})

test('manifest rejects path traversal, aliases, deferred grants, invalid UTF-8 and unbounded records', async () => {
  const examples = [ndjson([{ ...folder, path: '../escape' }]), ndjson([folder, { ...folder, fileId: 'other', path: 'research' }]),
    ndjson([{ ...folder, kind: 'file', hydration: 'deferred', sizeBytes: 20000000, reason: 'file_limit' }]),
    new Response(new Uint8Array([255])), new Response('x'.repeat(16385)),
    new Response(JSON.stringify({ type: 'manifest', version: 1 }) + '\n' + JSON.stringify({ type: 'entry', entry: folder })),
    new Response('{"type":"manifest","version":1}\n{"type":"complete","entries":1}\n')]
  for (const response of examples) {
    const client = new AgentDriveClient({ apiUrl: 'https://preview.invalid/api/agent-drive', now: () => 1000,
      credentials: async () => credential(), fetch: async () => response })
    await assert.rejects(client.manifest())
  }
  assert.throws(() => new AgentDriveClient({ apiUrl: 'http://untrusted.invalid/api/agent-drive', credentials: async () => credential() }), /DRIVE_INVALID_ORIGIN/)
})

test('full multi-range bytes verify across token expiry without changing the original file grant', async () => {
  const bytes = new TextEncoder().encode('Exact full deliverable 🙂\n'.repeat(50000))
  const entry: DriveReadyEntry = { fileId: 'file', path: 'Research/report.txt', updatedAt: 1, kind: 'file', hydration: 'ready',
    sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), metadataMac: mac, downloadMac: mac }
  let clock = 1000, renewals = 0, ranges = 0
  const client = new AgentDriveClient({ apiUrl: 'https://preview.invalid/api/agent-drive', now: () => clock,
    credentials: async () => credential(++renewals, clock + 120000), fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.downloadMac, mac)
      const chunk = bytes.slice(body.offset, body.offset + body.length)
      ranges++
      clock += 120000
      return new Response(chunk, { status: 206, headers: { 'x-overlay-drive-size': String(bytes.length),
        'content-range': `bytes ${body.offset}-${body.offset + chunk.length - 1}/${bytes.length}` } })
    } })
  assert.equal(Buffer.from(await client.download(entry)).equals(Buffer.from(bytes)), true)
  assert.equal(ranges, 2)
  assert.equal(renewals, 2)
})

test('empty files round-trip while oversized, changed-range and corrupted responses are refused', async () => {
  const entry: DriveReadyEntry = { fileId: 'file', path: 'empty.txt', updatedAt: 1, kind: 'file', hydration: 'ready',
    sizeBytes: 0, sha256: emptyHash, metadataMac: mac, downloadMac: mac }
  const client = (response: Response) => new AgentDriveClient({ apiUrl: 'https://preview.invalid/api/agent-drive', now: () => 1000,
    credentials: async () => credential(), fetch: async () => response })
  assert.equal((await client(new Response(null, { headers: { 'x-overlay-drive-size': '0' } })).download(entry)).length, 0)
  await assert.rejects(client(new Response('unexpected', { headers: { 'x-overlay-drive-size': '0' } })).download(entry), /DRIVE_RESPONSE_LIMIT/)
  const nonempty = { ...entry, sizeBytes: 1, sha256: createHash('sha256').update('a').digest('hex') }
  await assert.rejects(client(new Response('a', { status: 206, headers: { 'x-overlay-drive-size': '1', 'content-range': 'bytes 1-1/1' } })).download(nonempty), /DRIVE_RANGE_CHANGED/)
  await assert.rejects(client(new Response('b', { status: 206, headers: { 'x-overlay-drive-size': '1', 'content-range': 'bytes 0-0/1' } })).download(nonempty), /DRIVE_HASH_MISMATCH/)
})

test('staging PUT sends no drive credential and lost commit acknowledgement requires an explicit same-id retry', async () => {
  const uploadId = '24b3d8ed-21b2-43f3-9617-000000000001'
  const bytes = new TextEncoder().encode('saved')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let puts = 0, commits = 0
  const result = { fileId: 'file', updatedAt: 2, name: 'saved.txt', conflict: false, objectStored: true, sha256, sizeBytes: bytes.length }
  const client = new AgentDriveClient({ apiUrl: 'https://preview.invalid/api/agent-drive', now: () => 1000,
    credentials: async () => credential(), fetch: async (url, init) => {
      if (String(url).startsWith('https://storage.invalid/')) {
        puts++
        assert.equal(new Headers(init?.headers).has('authorization'), false)
        assert.equal(init?.redirect, 'error')
        assert.equal(Buffer.from(await new Response(init?.body).arrayBuffer()).equals(Buffer.from(bytes)), true)
        return new Response(null)
      }
      const body = JSON.parse(String(init?.body))
      if (body.action === 'upload') return Response.json({ state: 'pending', uploadId, sizeBytes: bytes.length, expiresIn: 120,
        url: 'https://storage.invalid/staging?signature=test-only', headers: { 'content-type': 'text/plain', 'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString('base64') } })
      commits++
      assert.equal(body.uploadId, uploadId)
      return commits === 1 ? Response.json({ error: 'DRIVE_REQUEST_FAILED', private: 'must-not-leak' }, { status: 500 }) : Response.json(result)
    } })
  const intent = await client.intent({ action: 'upload', requestId: 'staging-client-request', operation: { kind: 'create', name: 'saved.txt' }, mimeType: 'text/plain', sha256, sizeBytes: bytes.length })
  if (intent.state !== 'pending') throw Error('Expected pending upload')
  await client.upload(intent, bytes, sha256)
  assert.equal(puts, 1)
  await assert.rejects(client.commit(uploadId), error => error instanceof DriveRequestError && !error.message.includes('must-not-leak'))
  assert.equal(commits, 1)
  assert.deepEqual(await client.commit(uploadId), result)
  assert.equal(commits, 2)
})
