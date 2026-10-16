import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, symlinkSync, linkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SqliteDriveJournal, type DriveJournalContext } from './drive-journal'

const context: DriveJournalContext = { environmentId: 'environment', runId: 'run', sessionId: 'session',
  scope: { kind: 'personal', workspaceId: 'workspace', ownerUserId: 'owner' },
  execution: { attemptId: 'attempt', generation: 1 } }
const uploadId = '24b3d8ed-21b2-43f3-9617-000000000001'
const bytes = Buffer.from('Complete deliverable 🙂\n'.repeat(10000))
const request = { action: 'upload' as const, requestId: 'journal-request-0001',
  operation: { kind: 'create' as const, name: 'report.txt' }, mimeType: 'text/plain',
  sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length }
const result = { fileId: 'file', updatedAt: 2, name: 'report.txt', conflict: false,
  objectStored: true, sha256: request.sha256, sizeBytes: request.sizeBytes }
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'drive-journal-'))
  return { path: join(directory, 'private', 'drive.sqlite'), clean: () => rmSync(directory, { recursive: true, force: true }) }
}

test('restart recovers immutable pending bytes and a lost commit acknowledgement without a second write identity', () => {
  const f = fixture()
  let journal: SqliteDriveJournal | undefined
  try {
    journal = new SqliteDriveJournal(f.path, context)
    const localBytes = Buffer.from(bytes)
    journal.prepareContent(request, localBytes)
    localBytes.fill(0)
    journal.advanceContent(request.requestId, 'intent', uploadId)
    journal.advanceContent(request.requestId, 'uploaded', uploadId)
    journal.advanceContent(request.requestId, 'committing', uploadId)
    journal.close()
    journal = new SqliteDriveJournal(f.path, context)
    // Windows chmod exposes only the read-only bit, not POSIX owner/group modes.
    if (process.platform !== 'win32') assert.equal(statSync(f.path).mode & 0o777, 0o600)
    else assert.ok(statSync(f.path).isFile())
    assert.deepEqual(Buffer.from(journal.content(request.requestId)), bytes)
    assert.equal(journal.prepareContent(request, bytes).phase.kind, 'committing')
    journal.commitContent(request.requestId, uploadId, result)
    journal.close()
    journal = new SqliteDriveJournal(f.path, context)
    assert.equal(journal.pending().length, 0)
    assert.equal(journal.find(request.requestId)?.phase.kind, 'committed')
    assert.deepEqual(journal.commitContent(request.requestId, uploadId, result).phase, { kind: 'committed', uploadId, result })
    assert.throws(() => journal.content(request.requestId), /CONTENT_UNAVAILABLE/)
    assert.throws(() => journal.commitContent(request.requestId, uploadId, { ...result, fileId: 'duplicate' }), /RECEIPT_CHANGED/)
    journal.close()
  } finally { try { journal?.close() } catch { /* A successful path already closed it. */ } f.clean() }
})

test('scope and execution changes cannot silently adopt pending writes', () => {
  const f = fixture()
  try {
    const journal = new SqliteDriveJournal(f.path, context)
    journal.prepareContent(request, bytes)
    journal.close()
    assert.throws(() => new SqliteDriveJournal(f.path, { ...context, scope: { kind: 'workspace', workspaceId: 'workspace' } }), /SCOPE_CHANGED/)
    assert.throws(() => new SqliteDriveJournal(f.path, { ...context, execution: { attemptId: 'new-attempt', generation: 2 } }), /UNSAVED_OTHER_EXECUTION/)
    const recovered = new SqliteDriveJournal(f.path, context)
    assert.deepEqual(Buffer.from(recovered.content(request.requestId)), bytes)
    recovered.commitContent(request.requestId, uploadId, result)
    recovered.close()
    const next = new SqliteDriveJournal(f.path, { ...context, runId: 'next-run', sessionId: 'next-session' })
    assert.equal(next.pending().length, 0)
    assert.throws(() => next.find(request.requestId), /EXECUTION_CHANGED/)
    next.close()
  } finally { f.clean() }
})

test('request reuse, changed bytes and invalid phase jumps leave the original pending write intact', () => {
  const f = fixture()
  try {
    const journal = new SqliteDriveJournal(f.path, context)
    assert.throws(() => journal.prepareContent(request, Buffer.from('wrong')), /CONTENT_CHANGED/)
    journal.prepareContent(request, bytes)
    assert.throws(() => journal.prepareContent({ ...request, operation: { kind: 'create', name: 'other.txt' } }, bytes), /REQUEST_CONFLICT/)
    assert.throws(() => journal.advanceContent(request.requestId, 'uploaded', uploadId), /INVALID_TRANSITION/)
    journal.advanceContent(request.requestId, 'intent', uploadId)
    assert.throws(() => journal.advanceContent(request.requestId, 'uploaded', '24b3d8ed-21b2-43f3-9617-000000000002'), /REQUEST_CONFLICT/)
    assert.throws(() => journal.commitContent(request.requestId, uploadId, { ...result, sha256: '0'.repeat(64) }), /REQUEST_CONFLICT/)
    assert.equal(journal.pending()[0]?.phase.kind, 'intent')
    assert.deepEqual(Buffer.from(journal.content(request.requestId)), bytes)
    journal.close()
  } finally { f.clean() }
})

test('metadata completion is durable and replay preserves its original receipt', () => {
  const f = fixture()
  try {
    const operation = { action: 'metadata' as const, requestId: 'metadata-request-001', operation: { kind: 'mkdir' as const, name: 'Empty folder' } }
    let journal = new SqliteDriveJournal(f.path, context)
    journal.prepareMetadata(operation)
    journal.advanceMetadata(operation.requestId)
    journal.close()
    journal = new SqliteDriveJournal(f.path, context)
    assert.equal(journal.prepareMetadata(operation).phase.kind, 'committing')
    journal.advanceMetadata(operation.requestId, { fileId: 'folder', updatedAt: 3 })
    assert.equal(journal.pending().length, 0)
    assert.throws(() => journal.advanceMetadata(operation.requestId, { fileId: 'other', updatedAt: 3 }), /RECEIPT_CHANGED/)
    journal.close()
  } finally { f.clean() }
})

test('journal refuses symlinks and hard links without altering the linked file', () => {
  const f = fixture()
  try {
    const target = join(f.path, '..', '..', 'target')
    writeFileSync(target, 'preserve')
    const link = join(target, '..', 'link')
    symlinkSync(target, link)
    assert.throws(() => new SqliteDriveJournal(link, context), /UNSAFE_JOURNAL/)
    const hard = join(target, '..', 'hard')
    linkSync(target, hard)
    assert.throws(() => new SqliteDriveJournal(hard, context), /UNSAFE_JOURNAL/)
  } finally { f.clean() }
})
