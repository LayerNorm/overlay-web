import assert from 'node:assert/strict'
import test from 'node:test'
import type { BillingProvider } from '@overlay/app-core'
import { createFreeEntitlements } from '@overlay/billing'
import { NoteService, NoteServiceError, type NoteRecord, type NoteRepository } from './NoteService'

const now = Date.now()

function createNoteRepository(): NoteRepository {
  const notes = new Map<string, NoteRecord>()
  return {
    async getNote({ noteId }) {
      return notes.get(noteId) ?? null
    },
    async listNotes() {
      return [...notes.values()]
    },
    async createNote({ userId, title, content, projectId }) {
      const id = `note_${notes.size + 1}`
      const note: NoteRecord = {
        _id: id,
        userId,
        name: title,
        kind: 'note',
        content,
        textContent: content,
        projectId,
        createdAt: now,
        updatedAt: now,
      }
      notes.set(id, note)
      return { id, note }
    },
    async updateNote() {
      return null
    },
    async deleteNote() {
      return null
    },
  }
}

test('NoteService.createNote checks billing write quota before creating', async () => {
  let createCalls = 0
  const repository = createNoteRepository()
  const originalCreate = repository.createNote.bind(repository)
  repository.createNote = async (args) => {
    createCalls += 1
    return originalCreate(args)
  }

  const billing: Pick<BillingProvider, 'getEntitlements'> = {
    async getEntitlements() {
      return {
        ...createFreeEntitlements(),
        dailyUsage: { ask: 0, write: 1, agent: 0 },
        dailyLimits: { ask: 10, write: 1, agent: 10 },
      }
    },
  }

  const service = new NoteService({ billing, noteRepository: repository })
  await assert.rejects(
    () => service.createNote({ userId: 'user_1', title: 'Blocked', content: '' }),
    (error) => error instanceof NoteServiceError && error.statusCode === 402,
  )
  assert.equal(createCalls, 0)
})

test('NoteService.updateNote forwards the expected revision to the repository', async () => {
  let expectedRevision: number | undefined
  const repository = createNoteRepository()
  repository.updateNote = async (args) => {
    expectedRevision = args.expectedUpdatedAt
    return {
      _id: args.noteId,
      userId: args.userId,
      name: args.title ?? 'Untitled',
      kind: 'note',
      content: args.content ?? '',
      textContent: args.content ?? '',
      createdAt: now,
      updatedAt: now + 1,
    }
  }

  const service = new NoteService({ noteRepository: repository })
  const result = await service.updateNote({
    noteId: 'note_1',
    userId: 'user_1',
    title: 'Updated',
    content: '<p>Updated</p>',
    expectedUpdatedAt: now,
  })

  assert.equal(expectedRevision, now)
  assert.equal(result.note?.updatedAt, now + 1)
})
