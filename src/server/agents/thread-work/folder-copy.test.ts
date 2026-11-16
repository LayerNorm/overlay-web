import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileServiceError } from '@/server/files/FileServiceErrors'
import type { FolderCopyRecord, FolderSubtree, ThreadWorkRepository } from './ConvexThreadWorkRepository'
import {
  copyFolderIn, diffFolderCopy, isCompleteListing, listingScript, parseListing, planFolderCopy, saveFolderBack,
  type FolderFiles, type WorkMachine,
} from './folder-copy'

const encoder = new TextEncoder()
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const limits = { maxFileBytes: 1_000, maxTotalBytes: 5_000, maxFiles: 50 }

test('the listing script reports size, hash and path, and skips dependency folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'overlay-listing-'))
  try {
    mkdirSync(join(root, 'notes'))
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(root, 'notes', 'Launch FAQ.md'), '# FAQ\n')
    writeFileSync(join(root, 'node_modules', 'x', 'index.js'), 'ignored')
    writeFileSync(join(root, 'with space.txt'), 'hi')
    const stdout = execFileSync('sh', ['-c', listingScript()], { cwd: root, encoding: 'utf8' })
    const listing = parseListing(stdout)
    assert.deepEqual([...listing.keys()].sort(), ['notes/Launch FAQ.md', 'with space.txt'])
    assert.deepEqual(listing.get('notes/Launch FAQ.md'), { size: 6, sha256: sha('# FAQ\n') })
    assert.equal(isCompleteListing(stdout), true)
    // Cut off partway through: incomplete, and the half line is ignored.
    const cut = stdout.slice(0, stdout.indexOf('with space') + 4)
    assert.equal(isCompleteListing(cut), false)
    assert.ok(![...parseListing(cut).keys()].some(path => path.startsWith('with')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the plan turns notes into Markdown files, keeps names unique and respects limits', () => {
  const plan = planFolderCopy([
    { id: 'n1', name: 'Plan', type: 'file', kind: 'note', parentId: 'root', updatedAt: 1, sizeBytes: 10, hasStorageObject: false, textInObjectStore: false },
    { id: 'n2', name: 'Plan.md', type: 'file', kind: 'upload', parentId: 'root', updatedAt: 1, sizeBytes: 10, hasStorageObject: false, textInObjectStore: false },
    { id: 'd1', name: 'node_modules', type: 'folder', parentId: 'root', updatedAt: 1, hasStorageObject: false, textInObjectStore: false },
    { id: 'b1', name: 'deck.pdf', type: 'file', kind: 'upload', parentId: 'root', updatedAt: 1, sizeBytes: 2_000, hasStorageObject: true, textInObjectStore: false },
    { id: 'd2', name: 'Research', type: 'folder', parentId: 'root', updatedAt: 1, hasStorageObject: false, textInObjectStore: false },
    { id: 'b2', name: 'chart.png', type: 'file', kind: 'upload', parentId: 'd2', updatedAt: 1, sizeBytes: 100, hasStorageObject: true, textInObjectStore: false },
  ], 'root', limits)
  assert.deepEqual(plan.files.map(file => [file.path, file.kind]), [['Plan.md', 'note'], ['Plan (2).md', 'text'], ['Research/chart.png', 'binary']])
  assert.deepEqual(plan.skipped, ['node_modules', 'deck.pdf'])
  assert.deepEqual(plan.folders.map(folder => folder.path), ['', 'Research'])
})

test('changes are new, changed or deleted relative to what was copied', () => {
  const entries = [
    { path: 'a.md', fileId: 'a', parentId: 'root', kind: 'note' as const, updatedAt: 1, sha256: sha('a') },
    { path: 'b.txt', fileId: 'b', parentId: 'root', kind: 'text' as const, updatedAt: 1, sha256: sha('b') },
  ]
  const listing = new Map([
    ['a.md', { size: 2, sha256: sha('a2') }],
    ['c.txt', { size: 1, sha256: sha('c') }],
    ['.env', { size: 1, sha256: sha('secret') }],
  ])
  const changes = diffFolderCopy(entries, listing)
  assert.deepEqual(changes.changed.map(change => change.entry.path), ['a.md'])
  assert.deepEqual(changes.added.map(change => change.path), ['c.txt'])
  assert.deepEqual(changes.deleted.map(entry => entry.path), ['b.txt'])
})

/** An in-memory computer and Files service, enough to run a copy in and a save back. */
function harness() {
  const disk = new Map<string, Uint8Array>()
  const output = { cutOff: false }
  const machine: WorkMachine = {
    target: 'cloud', base: '/workspace', ...limits,
    run: async (script, cwd) => {
      const removed = /^rm -rf -- '([^']+)'/.exec(script)?.[1]
      if (removed) for (const path of [...disk.keys()]) if (path.startsWith(`${removed}/`)) disk.delete(path)
      if (!script.includes('find .')) return { exitCode: 0, stdout: '', stderr: '' }
      const prefix = `${cwd}/`
      const lines = [...disk.entries()].filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) =>
        `${bytes.byteLength}\t${createHash('sha256').update(bytes).digest('hex')}\t${path.slice(prefix.length)}\n`)
      // A cut-off listing loses its last line, its end marker and half of the line before.
      const stdout = output.cutOff ? lines.slice(0, -1).join('') : `${lines.join('')}__overlay_listing_end__\n`
      return { exitCode: 0, stdout, stderr: '' }
    },
    write: async (files) => { for (const file of files) disk.set(file.path, file.contents) },
    read: async (path) => disk.get(path) ?? null,
  }
  const rows = new Map<string, { content?: string; updatedAt: number; name: string; parentId?: string; kind?: string }>([
    ['note1', { content: '# Plan\n', updatedAt: 10, name: 'Plan', kind: 'note' }],
    ['text1', { content: 'old', updatedAt: 10, name: 'data.csv', kind: 'upload' }],
    ['gone1', { content: 'bye', updatedAt: 10, name: 'old.txt', kind: 'upload' }],
  ])
  const calls: string[] = []
  let nextId = 1
  const files = {
    getOrListFiles: async ({ fileId }: { fileId?: string | null }) => {
      const row = rows.get(String(fileId))
      if (!row) throw new FileServiceError({ error: 'Not found' }, 404)
      return { ...row, textContent: row.content, scope: 'workspace' }
    },
    readFileBytes: async () => null,
    updateFile: async ({ body }: { body: Record<string, unknown> }) => {
      const row = rows.get(String(body.fileId))!
      if (body.expectedUpdatedAt !== row.updatedAt) throw new FileServiceError({ error: 'The file changed since it was read.', conflict: true }, 409)
      row.content = String(body.content ?? body.textContent)
      row.updatedAt += 1
      calls.push(`update:${body.fileId}`)
      return { success: true as const }
    },
    createFile: async ({ body }: { body: Record<string, unknown> }) => {
      const id = `new${nextId++}`
      rows.set(id, { content: String(body.content ?? body.textContent ?? ''), updatedAt: 1, name: String(body.name), kind: String(body.kind) })
      calls.push(`create:${body.kind}:${body.name}:${body.byAgent === true}`)
      return { id }
    },
    createFileFromBytes: async ({ name }: { name: string }) => { calls.push(`bytes:${name}`); return { id: `new${nextId++}` } },
    deleteFile: async ({ fileId }: { fileId?: string | null }) => { calls.push(`delete:${fileId}`); return { success: true as const } },
  } as unknown as FolderFiles
  let record: FolderCopyRecord | null = null
  const subtree: FolderSubtree = {
    folder: { id: 'root', name: 'Launch', scope: 'workspace', userId: 'u1' },
    truncated: false,
    rows: [
      { id: 'note1', name: 'Plan', type: 'file', kind: 'note', parentId: 'root', updatedAt: 10, sizeBytes: 7, hasStorageObject: false, textInObjectStore: false },
      { id: 'text1', name: 'data.csv', type: 'file', kind: 'upload', parentId: 'root', updatedAt: 10, sizeBytes: 3, hasStorageObject: false, textInObjectStore: false },
      { id: 'gone1', name: 'old.txt', type: 'file', kind: 'upload', parentId: 'root', updatedAt: 10, sizeBytes: 3, hasStorageObject: false, textInObjectStore: false },
    ],
  }
  const repository: ThreadWorkRepository = {
    getWork: async () => null,
    subtree: async () => subtree,
    startCopy: async (input) => {
      if (record) return { created: false, status: record.status }
      record = { ...input, entries: [], folders: [], skipped: [], status: 'copying', createdAt: 1 }
      return { created: true, status: 'copying' }
    },
    listCopies: async () => (record ? [record] : []),
    attachSummary: async () => undefined,
    updateCopy: async ({ copyId: _copyId, expectedStatus, ...patch }) => {
      if (!record) throw new Error('missing')
      if (expectedStatus && record.status !== expectedStatus) return { updated: false, status: record.status }
      record = { ...record, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) } as FolderCopyRecord
      return { updated: true, status: patch.status }
    },
  }
  return { disk, output, machine, rows, files, repository, calls, record: () => record!, reset: () => { record = null } }
}

const run = { agentRunId: 'run1', conversationId: 'c1', workspaceId: 'w1', userId: 'u1', agentId: 'a1', agentName: 'Atlas', messageId: 'm1' }

test('a copy in writes the folder and records what it held', async () => {
  const h = harness()
  const result = await copyFolderIn({ repository: h.repository, files: h.files, machine: h.machine, run, folder: { fileId: 'root', name: 'Launch' }, directoryName: 'Launch' })
  assert.ok(!('error' in result))
  assert.equal(new TextDecoder().decode(h.disk.get('/workspace/Launch/Plan.md')), '# Plan\n')
  assert.equal(h.record().status, 'copied')
  assert.equal(h.record().entries.length, 3)
  const again = await copyFolderIn({ repository: h.repository, files: h.files, machine: h.machine, run, folder: { fileId: 'root', name: 'Launch' }, directoryName: 'Launch' })
  assert.ok(!('error' in again) && again.alreadyCopied)
})

test('saving back updates, creates and deletes through Files, and never overwrites an edit made meanwhile', async () => {
  const h = harness()
  await copyFolderIn({ repository: h.repository, files: h.files, machine: h.machine, run, folder: { fileId: 'root', name: 'Launch' }, directoryName: 'Launch' })
  h.disk.set('/workspace/Launch/Plan.md', encoder.encode('# Plan\n\nAgent edit.\n'))
  h.disk.set('/workspace/Launch/data.csv', encoder.encode('new'))
  h.disk.set('/workspace/Launch/Launch FAQ.md', encoder.encode('# FAQ\n'))
  h.disk.set('/workspace/Launch/.env', encoder.encode('SECRET=1'))
  h.disk.delete('/workspace/Launch/old.txt')
  // Someone edits the CSV in the app while the agent works.
  h.rows.get('text1')!.updatedAt = 11
  const summary = await saveFolderBack({ repository: h.repository, files: h.files, machine: h.machine, copy: h.record(), agentName: 'Atlas', scope: 'workspace' })
  assert.ok(summary)
  assert.deepEqual(summary.saved.map(item => [item.path, item.action]).sort(), [
    ['Launch FAQ.md', 'created'], ['Plan.md', 'updated'], ['data.csv', 'saved_as_copy'], ['old.txt', 'deleted'],
  ])
  assert.ok(h.calls.includes('create:upload:data (Atlas’s copy).csv:true'))
  assert.ok(h.calls.includes('create:note:Launch FAQ:true'))
  assert.ok(!h.calls.some(call => call.includes('.env')))
  assert.equal(h.record().status, 'saved')
  // A second save of the same run does nothing.
  assert.equal(await saveFolderBack({ repository: h.repository, files: h.files, machine: h.machine, copy: h.record(), agentName: 'Atlas', scope: 'workspace' }), null)
})

test('a copy in starts from an empty folder, so files left by an earlier run are not saved as new', async () => {
  const h = harness()
  h.disk.set('/workspace/Launch/left over.txt', encoder.encode('from an earlier run'))
  await copyFolderIn({ repository: h.repository, files: h.files, machine: h.machine, run, folder: { fileId: 'root', name: 'Launch' }, directoryName: 'Launch' })
  assert.equal(h.disk.has('/workspace/Launch/left over.txt'), false)
  const summary = await saveFolderBack({ repository: h.repository, files: h.files, machine: h.machine, copy: h.record(), agentName: 'Atlas', scope: 'workspace' })
  assert.deepEqual(summary?.saved, [])
})

test('a listing that was cut off never deletes files from Files', async () => {
  const h = harness()
  await copyFolderIn({ repository: h.repository, files: h.files, machine: h.machine, run, folder: { fileId: 'root', name: 'Launch' }, directoryName: 'Launch' })
  h.output.cutOff = true
  const summary = await saveFolderBack({ repository: h.repository, files: h.files, machine: h.machine, copy: h.record(), agentName: 'Atlas', scope: 'workspace' })
  assert.ok(summary)
  assert.ok(!h.calls.some(call => call.startsWith('delete:')))
  assert.equal(summary.saved.length, 0)
  assert.match(summary.failed[0]?.reason ?? '', /nothing was deleted/)
})
