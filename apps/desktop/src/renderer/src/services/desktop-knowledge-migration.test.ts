import { createHash } from 'node:crypto'

import type {
  KnowledgeFile,
  KnowledgeMigrationJournal,
  NoteDoc,
} from '@overlay/app-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  runDesktopKnowledgeMigration,
  type DesktopKnowledgeMigrationLocalPort,
  type DesktopKnowledgeMigrationRemotePort,
} from './desktop-knowledge-migration'

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function noteChecksum(title: string, content: string): string {
  return checksum(`${title.trim()}\0${content}`)
}

function createFixture() {
  let journal: KnowledgeMigrationJournal | null = null
  const notes: NoteDoc[] = [
    {
      _id: 'remote-conflict',
      title: 'Plan',
      content: 'Remote content',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ]
  const files: KnowledgeFile[] = []
  const data = new Uint8Array([1, 2, 3])
  const dataChecksum = checksum(data as unknown as string)
  const local: DesktopKnowledgeMigrationLocalPort = {
    inventory: vi.fn().mockResolvedValue({
      notes: [
        { id: 'local-note', title: 'Plan', content: 'Local content', updatedAt: 5, checksum: noteChecksum('Plan', 'Local content') },
        { id: 'local-duplicate', title: 'Plan', content: 'Local content', updatedAt: 5, checksum: noteChecksum('Plan', 'Local content') },
      ],
      documents: [
        { id: 'local-document', name: 'brief.txt', mimeType: 'text/plain', sizeBytes: 3, createdAt: 2, checksum: dataChecksum, assetId: 'asset-document' },
      ],
      attachments: [],
    }),
    readAsset: vi.fn().mockResolvedValue({
      dataBase64: Buffer.from(data).toString('base64'),
      asset: { id: 'asset-document', name: 'brief.txt', mimeType: 'text/plain', sizeBytes: 3, checksum: dataChecksum, source: 'document', documentId: 'local-document' },
    }),
    createBackup: vi.fn().mockResolvedValue({ backupId: 'backup-1' }),
    loadJournal: vi.fn().mockImplementation(async () => journal),
    saveJournal: vi.fn().mockImplementation(async (_userId, next) => {
      journal = structuredClone(next)
    }),
  }
  const remote: DesktopKnowledgeMigrationRemotePort = {
    listNotes: vi.fn().mockImplementation(async () => [...notes]),
    listFiles: vi.fn().mockImplementation(async () => [...files]),
    getNote: vi.fn().mockImplementation(async (id) => notes.find((note) => note._id === id) ?? null),
    getFile: vi.fn().mockImplementation(async (id) => files.find((file) => file._id === id) ?? null),
    createNote: vi.fn().mockImplementation(async (input) => {
      const note: NoteDoc = { _id: `note-${notes.length}`, title: input.title, content: input.content, clientId: input.clientId, tags: [], createdAt: 3, updatedAt: 3 }
      notes.push(note)
      return note
    }),
    updateNote: vi.fn().mockImplementation(async (input) => {
      const note = notes.find((entry) => entry._id === input.noteId)!
      Object.assign(note, { title: input.title, content: input.content, updatedAt: note.updatedAt + 1 })
      return note
    }),
    uploadFile: vi.fn().mockImplementation(async (input) => {
      const file: KnowledgeFile = { _id: `file-${files.length}`, clientId: input.clientId, name: input.resolvedName, type: 'file', kind: 'upload', parentId: null, mimeType: input.mimeType, sizeBytes: input.sizeBytes, createdAt: 4, updatedAt: 4 }
      files.push(file)
      return file
    }),
  }
  return { local, remote, getJournal: () => journal }
}

describe('desktop knowledge migration', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', globalThis.crypto)
  })

  it('backs up, resolves conflicts, checksum-deduplicates, verifies, and records stable mappings', async () => {
    const fixture = createFixture()
    const mappings = vi.fn()
    const result = await runDesktopKnowledgeMigration('user-1', {
      local: fixture.local,
      remote: fixture.remote,
      now: () => 100,
      onMappingsVerified: mappings,
    })

    expect(result.journal.phase).toBe('completed')
    expect(result.journal.backupId).toBe('backup-1')
    expect(fixture.local.createBackup).toHaveBeenCalledTimes(1)
    expect(fixture.remote.createNote).toHaveBeenCalledTimes(1)
    expect(fixture.remote.uploadFile).toHaveBeenCalledTimes(1)
    expect(fixture.remote.createNote).toHaveBeenCalledWith(expect.objectContaining({ title: 'Plan (On this Mac)' }))
    expect(result.journal.mappings.nodes['local-duplicate']).toBe(result.journal.mappings.nodes['local-note'])
    expect(result.deduplicated).toBe(1)
    expect(mappings).toHaveBeenCalledTimes(1)
  })

  it('resumes a failed verification from the journal without uploading a duplicate', async () => {
    const fixture = createFixture()
    let failOnce = true
    const originalGetFile = fixture.remote.getFile
    fixture.remote.getFile = vi.fn(async (id) => {
      if (failOnce) {
        failOnce = false
        return null
      }
      return originalGetFile(id)
    })

    await expect(runDesktopKnowledgeMigration('user-1', {
      local: fixture.local,
      remote: fixture.remote,
      now: () => 100,
    })).rejects.toThrow(/verification failed/)
    expect(fixture.getJournal()?.phase).toBe('failed')

    await runDesktopKnowledgeMigration('user-1', {
      local: fixture.local,
      remote: fixture.remote,
      now: () => 200,
    })
    expect(fixture.remote.uploadFile).toHaveBeenCalledTimes(1)
    expect(fixture.local.createBackup).toHaveBeenCalledTimes(1)
    expect(fixture.getJournal()?.phase).toBe('completed')
  })
})
