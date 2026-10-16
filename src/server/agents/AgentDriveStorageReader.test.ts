import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { AgentDriveStorageReader } from './AgentDriveStorageReader'

const source = { kind: 'convex' as const, storageId: 'storage', fileId: 'file', updatedAt: 1 }
const bytes = new TextEncoder().encode('full source 🙂')
const metadata = { url: 'https://storage.invalid/download', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('base64') }
const defaults = { async objectSize() { return bytes.length }, async readObject() { return bytes }, async convexSource() { return metadata } }

test('real storage reader preserves object bytes and verifies Convex bytes against authoritative metadata', async () => {
  let authorizations = 0
  const reader = new AgentDriveStorageReader({ ...defaults,
    async convexSource(value) { assert.deepEqual(value, source); authorizations++; return metadata },
    async fetch(_url, options) { assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit'); return new Response(bytes) },
  })
  assert.equal(await reader.size(source), bytes.length)
  assert.deepEqual(await reader.read(source, 100), bytes)
  assert.equal(authorizations, 2)
  assert.deepEqual(await reader.read({ kind: 'object', key: 'canonical' }, 100), bytes)
})

test('metadata limits and revocation prevent a download, and altered same-size data fails its digest', async () => {
  let downloads = 0
  const limited = new AgentDriveStorageReader({ ...defaults, async fetch() { downloads++; throw Error('must not fetch') } })
  await assert.rejects(limited.read(source, 1), /DRIVE_FILE_TOO_LARGE/)
  const revoked = new AgentDriveStorageReader({ ...defaults, async convexSource() { throw Error('DRIVE_RUN_UNAVAILABLE') } })
  await assert.rejects(revoked.read(source, 100), /DRIVE_RUN_UNAVAILABLE/)
  assert.equal(downloads, 0)
  const altered = new AgentDriveStorageReader({ ...defaults, async fetch() { return new Response(new Uint8Array(bytes.length)) } })
  await assert.rejects(altered.read(source, 100), /DRIVE_SOURCE_CHANGED/)
})

test('unbounded objects, missing sources, insecure URLs and failed downloads are rejected', async () => {
  const reader = new AgentDriveStorageReader({ ...defaults, async objectSize() { return null }, async fetch() { return new Response(null, { status: 404 }) } })
  await assert.rejects(reader.size({ kind: 'object', key: 'missing' }), /DRIVE_FILE_UNAVAILABLE/)
  await assert.rejects(reader.read({ kind: 'object', key: 'large' }, 1), /DRIVE_FILE_TOO_LARGE/)
  await assert.rejects(reader.read(source, 100), /DRIVE_FILE_UNAVAILABLE/)
  const insecure = new AgentDriveStorageReader({ ...defaults, async convexSource() { return { ...metadata, url: 'http://storage.invalid' } } })
  await assert.rejects(insecure.read(source, 100), /DRIVE_INVALID_STORAGE_URL/)
})
