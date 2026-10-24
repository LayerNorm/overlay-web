import 'server-only'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { AgentDriveMaterializer, type AgentDriveSourceReader } from './AgentDriveMaterializer'
import type { AgentDriveCandidate } from '@/shared/agents/agent-drive-manifest'

const bytes = (text: string) => new TextEncoder().encode(text)
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const candidate = (fileId: string, source: AgentDriveCandidate['source']): AgentDriveCandidate => ({ fileId, path: `${fileId}.md`, kind: 'file', updatedAt: 10, ownerUserId: 'owner', source })

test('manifest hashes full canonical object and inline bytes, including text larger than the searchable prefix', async () => {
  const full = bytes('Full canonical text 🙂\n'.repeat(40000))
  const seen: Array<Parameters<AgentDriveSourceReader['size']>[0]> = []
  const reader: AgentDriveSourceReader = {
    async size(source) { seen.push(source); return full.byteLength },
    async read(source, maximum) { assert.equal(source.kind, 'object'); assert.ok(maximum >= full.byteLength); return full },
  }
  const materializer = new AgentDriveMaterializer(reader)
  const inline = candidate('inline', { kind: 'inline', text: 'inline\n' })
  const object = candidate('object', { kind: 'object', key: 'users/owner/files/object/version' })
  const result = await materializer.manifest([{ fileId: 'folder', path: 'folder', kind: 'folder', updatedAt: 1, ownerUserId: 'owner' }, inline, object])
  assert.deepEqual(result[0], { fileId: 'folder', path: 'folder', kind: 'folder', updatedAt: 1 })
  assert.deepEqual(result[1], { fileId: 'inline', path: 'inline.md', kind: 'file', updatedAt: 10, hydration: 'ready', sizeBytes: 7, sha256: hash(bytes('inline\n')) })
  assert.equal(result[2]?.kind === 'file' && result[2].hydration === 'ready' && result[2].sha256, hash(full))
  assert.ok(full.byteLength > 512000)
  assert.deepEqual(await materializer.read(object, { sizeBytes: full.byteLength, sha256: hash(full) }), full)
  assert.ok(seen.every(source => source.kind === 'object'))
})

test('oversized and over-budget entries remain explicit and are never downloaded or represented as empty files', async () => {
  let downloads = 0
  const materializer = new AgentDriveMaterializer({
    async size(source) { return source.kind === 'object' && source.key === 'large' ? 11 : 6 },
    async read() { downloads++; return bytes('123456') },
  }, { fileBytes: 10, totalBytes: 10, entries: 5 })
  const result = await materializer.manifest([
    candidate('large', { kind: 'object', key: 'large' }),
    candidate('first', { kind: 'object', key: 'first' }),
    candidate('second', { kind: 'object', key: 'second' }),
  ])
  assert.deepEqual(result.map(entry => entry.kind === 'file' && entry.hydration === 'deferred' ? entry.reason : 'ready'), ['file_limit', 'ready', 'cache_limit'])
  assert.equal(downloads, 1)
  assert.ok(result.every(entry => entry.kind !== 'file' || entry.sizeBytes > 0))
})

test('truncated storage reads and sources that change after a manifest fail instead of returning corrupt bytes', async () => {
  const object = candidate('object', { kind: 'convex', storageId: 'storage-id', fileId: 'object', updatedAt: 10 })
  const materializer = new AgentDriveMaterializer({ async size() { return 8 }, async read() { return bytes('short') } })
  await assert.rejects(materializer.read(object), /DRIVE_SOURCE_CHANGED/)
  const changing = new AgentDriveMaterializer({ async size() { return 5 }, async read() { return bytes('other') } })
  await assert.rejects(changing.read(object, { sizeBytes: 5, sha256: hash(bytes('first')) }), /DRIVE_SOURCE_CHANGED/)
  let calls = 0
  const resized = new AgentDriveMaterializer({ async size() { return ++calls === 1 ? 4 : 5 }, async read() { return bytes('other') } })
  await assert.rejects(resized.manifest([object]), /DRIVE_SOURCE_CHANGED/)
})

test('missing sources, invalid sizes and excessive manifests fail closed', async () => {
  const invalid = new AgentDriveMaterializer({ async size() { return -1 }, async read() { throw Error('must not read') } })
  await assert.rejects(invalid.manifest([candidate('invalid', { kind: 'object', key: 'key' })]), /DRIVE_INVALID_SOURCE_SIZE/)
  await assert.rejects(invalid.manifest([candidate('missing', undefined)]), /DRIVE_FILE_UNAVAILABLE/)
  const limited = new AgentDriveMaterializer({ async size() { return 0 }, async read() { return new Uint8Array() } }, { fileBytes: 1, totalBytes: 1, entries: 1 })
  await assert.rejects(limited.manifest([candidate('one', undefined), candidate('two', undefined)]), /DRIVE_TOO_MANY_ENTRIES/)
})

test('manifest reads make bounded concurrent progress while preserving input order and the cache budget', async () => {
  let active = 0, maximum = 0, autoRelease = false
  const waiting: Array<() => void> = []
  const reader: AgentDriveSourceReader = {
    async size() { return 1 },
    async read() {
      active++; maximum = Math.max(maximum, active)
      if (!autoRelease) await new Promise<void>(resolve => waiting.push(resolve))
      active--; return bytes('x')
    },
  }
  const candidates = Array.from({length: 9}, (_, n) => candidate(String(n), {kind: 'object', key: String(n)}))
  const pending = new AgentDriveMaterializer(reader, {fileBytes: 1, totalBytes: 8, entries: 9}).manifest(candidates)
  try {
    // Observe the first blocked I/O wave without a wall-clock performance assertion.
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.ok(active > 1, 'independent object reads must not serialize behind one slow source')
    assert.ok(active <= 4, 'file reads must remain bounded')
    while (waiting.length || active) {
      for (const release of waiting.splice(0).reverse()) release()
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    const entries = await pending
    assert.deepEqual(entries.map(entry => entry.fileId), candidates.map(entry => entry.fileId))
    assert.ok(maximum <= 4)
    const last = entries.at(-1)
    assert.ok(last?.kind === 'file')
    assert.equal(last.hydration, 'deferred')
    assert.equal(entries.filter(entry => entry.kind === 'file' && entry.hydration === 'ready').length, 8)
  } finally {
    autoRelease = true
    for (const release of waiting.splice(0)) release()
    await pending
  }
})
