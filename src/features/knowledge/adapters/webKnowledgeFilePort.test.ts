import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { uploadWebFile } from './webKnowledgeFilePort'

test('file-first Files upload preserves originals, scope and folder across a registration retry', async t => {
  const bytes = '%PDF-1.7\n% PR382 intentionally malformed fixture\n%%EOF\n'
  const file = new File([bytes], 'broken.pdf', { type: 'application/pdf' })
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const registrations: unknown[] = []
  let uploads = 0
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/ingest-jobs?capabilities=1')) {
      return Response.json({ 'files-file-first': true })
    }
    if (url.endsWith('/upload-url')) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        name: file.name, mimeType: file.type, sizeBytes: file.size, checksumSha256: checksum,
      })
      return Response.json({ uploadUrl: 'https://storage.example.test/original', r2Key: 'original-key' })
    }
    if (url === 'https://storage.example.test/original') {
      uploads++
      assert.equal(init?.method, 'PUT')
      assert.equal(init?.body, file)
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('if-none-match'), '*')
      assert.equal(headers.get('x-amz-checksum-sha256'), Buffer.from(checksum, 'hex').toString('base64'))
      return new Response(null, { status: 200 })
    }
    if (url.endsWith('/ingest-jobs')) {
      registrations.push(JSON.parse(String(init?.body)))
      return registrations.length === 1
        ? Response.json({ error: 'Temporary failure' }, { status: 503 })
        : Response.json({ fileId: 'saved-file', fileName: 'broken.pdf', status: 'ready' })
    }
    assert.fail(`Unexpected request: ${url}`)
  })

  const result = await uploadWebFile(file, 'folder-id', 'workspace')

  assert.equal(result.ok, true)
  assert.equal(result.file?._id, 'saved-file')
  assert.equal(result.file?.parentId, 'folder-id')
  assert.equal(uploads, 1)
  assert.equal(registrations.length, 2)
  const expected = {
    r2Key: 'original-key', fileName: file.name, mimeType: file.type, sizeBytes: file.size,
    checksumSha256: checksum, parentId: 'folder-id', scope: 'workspace',
  }
  assert.deepEqual(registrations, [expected, expected])
})

test('disabled file-first flag preserves legacy document ingestion and scope', async t => {
  const file = new File(['legacy text'], 'notes.txt', { type: 'text/plain' })
  let legacyUploads = 0
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/ingest-jobs?capabilities=1')) {
      return Response.json({ 'files-file-first': false })
    }
    assert.ok(url.endsWith('/ingest-document'), `Unexpected request: ${url}`)
    assert.ok(init?.body instanceof FormData)
    assert.equal(init.body.get('parentId'), 'folder-id')
    assert.equal(init.body.get('scope'), 'workspace')
    legacyUploads++
    return Response.json({ id: 'legacy-file' })
  })

  const result = await uploadWebFile(file, 'folder-id', 'workspace')

  assert.equal(result.ok, true)
  assert.equal(result.file?._id, 'legacy-file')
  assert.equal(legacyUploads, 1)
})

test('a permanent registration failure does not retry or fall back to parsing the original', async t => {
  const file = new File(['unreadable'], 'broken.pdf', { type: 'application/pdf' })
  let registrations = 0
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/ingest-jobs?capabilities=1')) {
      return Response.json({ 'files-file-first': true })
    }
    if (url.endsWith('/upload-url')) {
      return Response.json({ uploadUrl: 'https://storage.example.test/original', r2Key: 'original-key' })
    }
    if (url === 'https://storage.example.test/original') return new Response(null, { status: 200 })
    assert.ok(url.endsWith('/ingest-jobs'), `Unexpected request: ${url}`)
    registrations++
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  })

  assert.deepEqual(await uploadWebFile(file, null), {
    ok: false, error: 'Could not register file (HTTP 403)',
  })
  assert.equal(registrations, 1)
})
