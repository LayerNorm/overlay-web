import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentDriveClient } from './drive-client'
import { SqliteDriveJournal } from './drive-journal'
import { AgentDriveWriter } from './drive-writer'

const bytes = Buffer.from('Full deliverable 🙂\n'.repeat(20000))
const request = { action: 'upload' as const, requestId: 'durable-request-001',
  operation: { kind: 'create' as const, name: 'report.txt' }, mimeType: 'text/plain',
  sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length }
const uploadId = '24b3d8ed-21b2-43f3-9617-000000000001'
const result = { fileId: 'file', updatedAt: 2, name: 'report.txt', conflict: false,
  objectStored: true, sha256: request.sha256, sizeBytes: request.sizeBytes }
const scope = { kind: 'personal' as const, workspaceId: 'workspace', ownerUserId: 'owner' }
const context = { environmentId: 'environment', runId: 'run', sessionId: 'session', scope }

function fixture(failure: 'intent' | 'upload' | 'commit' | 'metadata') {
  const directory = mkdtempSync(join(tmpdir(), 'drive-writer-')), path = join(directory, 'drive.sqlite')
  const calls = { intents: 0, uploads: 0, commits: 0, metadata: 0, created: 0 }
  let failed = false, committed = false, received: Uint8Array | undefined
  const client = new AgentDriveClient({ apiUrl: 'https://preview.invalid/api/agent-drive', now: () => 1000,
    credentials: async () => ({ protocolVersion: 1, expiresAt: 10000000, scope,
      token: `ovdrive_${'x'.repeat(32)}.${'y'.repeat(43)}` }), fetch: async (url, options) => {
      if (String(url) === 'https://objects.invalid/staging') {
        calls.uploads++
        received = new Uint8Array(await new Response(options?.body).arrayBuffer())
        assert.deepEqual(Buffer.from(received), bytes)
        if (failure === 'upload' && !failed) { failed = true; throw Error('lost upload acknowledgement') }
        return new Response(null)
      }
      const body = JSON.parse(String(options?.body))
      if (body.action === 'upload') {
        calls.intents++
        assert.deepEqual(body, request)
        if (failure === 'intent' && !failed) { failed = true; throw Error('lost intent acknowledgement') }
        if (committed) return Response.json({ state: 'committed', uploadId, result })
        return Response.json({ state: 'pending', uploadId, url: 'https://objects.invalid/staging',
          headers: { 'content-type': 'text/plain', 'x-amz-checksum-sha256': Buffer.from(request.sha256, 'hex').toString('base64') },
          sizeBytes: bytes.length, expiresIn: 120 })
      }
      if (body.action === 'commit') {
        calls.commits++
        assert.equal(body.uploadId, uploadId)
        assert.deepEqual(Buffer.from(received ?? []), bytes)
        if (!committed) { committed = true; calls.created++ }
        if (failure === 'commit' && !failed) { failed = true; throw Error('lost commit acknowledgement') }
        return Response.json(result)
      }
      if (body.action === 'metadata') {
        calls.metadata++
        assert.equal(body.requestId, 'metadata-request-001')
        if (failure === 'metadata' && !failed) { failed = true; throw Error('lost metadata acknowledgement') }
        return Response.json({ fileId: 'folder', updatedAt: 4 })
      }
      throw Error('unexpected request')
    } })
  return { path, calls, client, clean: () => rmSync(directory, { recursive: true, force: true }) }
}

for (const failure of ['intent', 'upload', 'commit'] as const) {
  test(`restart after lost ${failure} acknowledgement retains bytes and creates one canonical file`, async () => {
    const f = fixture(failure)
    let journal = new SqliteDriveJournal(f.path, context)
    try {
      const local = Buffer.from(bytes)
      await assert.rejects(new AgentDriveWriter(journal, f.client).content(request, local), /lost .* acknowledgement/)
      local.fill(0)
      assert.equal(journal.pending().length, 1)
      journal.close()
      journal = new SqliteDriveJournal(f.path, context)
      const writer = new AgentDriveWriter(journal, f.client)
      assert.deepEqual(await writer.flush(), [{ requestId: request.requestId, kind: 'content', result }])
      assert.equal(journal.pending().length, 0)
      assert.equal(f.calls.created, 1)
      const calls = { ...f.calls }
      await writer.content(request, bytes)
      assert.deepEqual(f.calls, calls)
      if (failure === 'commit') assert.deepEqual(f.calls, { intents: 1, uploads: 1, commits: 2, metadata: 0, created: 1 })
    } finally { journal.close(); f.clean() }
  })
}

test('metadata retry after restart uses the persisted identity and a completed replay makes no HTTP request', async () => {
  const f = fixture('metadata')
  let journal = new SqliteDriveJournal(f.path, context)
  const operation = { action: 'metadata' as const, requestId: 'metadata-request-001', operation: { kind: 'mkdir' as const, name: 'Empty folder' } }
  try {
    await assert.rejects(new AgentDriveWriter(journal, f.client).metadata(operation), /lost metadata/)
    journal.close()
    journal = new SqliteDriveJournal(f.path, context)
    const writer = new AgentDriveWriter(journal, f.client)
    await writer.flush()
    await writer.metadata(operation)
    assert.equal(f.calls.metadata, 2)
    assert.equal(journal.pending().length, 0)
  } finally { journal.close(); f.clean() }
})

test('concurrent same-id submissions serialize to one upload and one commit', async () => {
  const f = fixture('metadata'), journal = new SqliteDriveJournal(f.path, context)
  try {
    const writer = new AgentDriveWriter(journal, f.client)
    const receipts = await Promise.all([writer.content(request, bytes), writer.content(request, bytes), writer.flush()])
    assert.deepEqual(receipts[0], receipts[1])
    assert.deepEqual(receipts[2], [])
    assert.deepEqual(f.calls, { intents: 1, uploads: 1, commits: 1, metadata: 0, created: 1 })
  } finally { journal.close(); f.clean() }
})
