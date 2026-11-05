import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAgentEntryThread } from './resolveAgentEntryThread'

test('agent entry opens the first visible thread rather than the original main thread', async () => {
  const newest = { conversationId: 'new', title: 'Newest' }
  const result = await resolveAgentEntryThread({
    list: async () => [
      { conversationId: 'archived', title: 'Archived', archivedAt: 1 },
      newest,
      { conversationId: 'old', title: 'Original' },
    ],
    fallback: async () => { throw new Error('Must not resolve main when a visible thread exists') },
  })
  assert.equal(result, newest)
})

test('agent entry resolves or creates a thread when no visible thread exists', async () => {
  const main = { conversationId: 'main', title: 'New thread' }
  assert.equal(await resolveAgentEntryThread({
    list: async () => [{ conversationId: 'archived', title: 'Archived', archivedAt: 1 }],
    fallback: async () => main,
  }), main)
})
