import assert from 'node:assert/strict'
import { ConvexError } from 'convex/values'
import test, { type TestContext } from 'node:test'
import { lazyConvex } from '@/server/database/lazy-convex'
import { ConvexNoteRepository } from './ConvexNoteRepository'
import { NoteRevisionConflictError, type NoteRecord } from './NoteService'

const note: NoteRecord = { _id: 'note_fixture', userId: 'user_fixture', name: 'Note',
  kind: 'note', content: 'Current content', createdAt: 1, updatedAt: 20 }

function secret(t: TestContext) {
  const previous = process.env.INTERNAL_API_SECRET
  process.env.INTERNAL_API_SECRET = 'fixture-internal'
  t.after(() => {
    if (previous === undefined) delete process.env.INTERNAL_API_SECRET
    else process.env.INTERNAL_API_SECRET = previous
  })
}

test('a rejected Convex revision becomes a note conflict instead of unchanged success', async t => {
  secret(t)
  t.mock.method(lazyConvex, 'query', async () => note)
  t.mock.method(lazyConvex, 'mutation', async (_path, args, options) => {
    assert.equal(args.expectedUpdatedAt, 10)
    assert.equal(args.workspaceId, 'workspace_fixture')
    // The HTTP adapter returns null on failure unless explicitly instructed.
    if (options?.throwOnError) throw new Error('NOTE_REVISION_CONFLICT')
    return null
  })
  await assert.rejects(new ConvexNoteRepository().updateNote({ noteId: note._id,
    userId: note.userId, workspaceId: 'workspace_fixture', content: 'Stale content', expectedUpdatedAt: 10 }),
  error => error instanceof NoteRevisionConflictError
    && error.expectedUpdatedAt === 10 && error.currentUpdatedAt === 20)
})

test('production-redacted Convex application data preserves a note revision conflict', async t => {
  secret(t)
  t.mock.method(lazyConvex, 'query', async () => note)
  t.mock.method(lazyConvex, 'mutation', async () => {
    const error = new ConvexError('NOTE_REVISION_CONFLICT')
    error.message = 'Server Error'
    throw error
  })
  await assert.rejects(new ConvexNoteRepository().updateNote({ noteId: note._id,
    userId: note.userId, content: 'Stale content', expectedUpdatedAt: 10 }),
  error => error instanceof NoteRevisionConflictError && error.currentUpdatedAt === 20)
})

test('other Convex update failures propagate rather than reporting a successful save', async t => {
  secret(t)
  t.mock.method(lazyConvex, 'query', async () => note)
  t.mock.method(lazyConvex, 'mutation', async (_path, _args, options) => {
    if (options?.throwOnError) throw new Error('Update failed')
    return null
  })
  await assert.rejects(new ConvexNoteRepository().updateNote({ noteId: note._id,
    userId: note.userId, content: 'New content' }), /Update failed/)
})

test('a successful update still returns the canonical file', async t => {
  secret(t)
  let saved = note
  t.mock.method(lazyConvex, 'query', async () => saved)
  t.mock.method(lazyConvex, 'mutation', async (_path, args, options) => {
    assert.equal(options?.throwOnError, true)
    saved = { ...note, content: String(args.content), updatedAt: 30 }
    return null
  })
  const result = await new ConvexNoteRepository().updateNote({ noteId: note._id,
    userId: note.userId, content: 'Saved content', expectedUpdatedAt: 20 })
  assert.equal(result?.content, 'Saved content')
  assert.equal(result?.updatedAt, 30)
})
