import assert from 'node:assert/strict'
import test from 'node:test'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import { searchContext } from './WorkPeekSections'

test('task context uses native workspace search and preserves note types', async () => {
  const query = (async (reference, args) => {
    assert.equal(getFunctionName(reference), 'search/browse:mentions')
    assert.deepEqual(args, { workspaceId: 'workspace', query: 'design' })
    return {
      files: [{ id: 'note', kind: 'note', name: 'Design note' }, { id: 'file', kind: 'file', name: 'Design file' }],
      chats: [{ id: 'chat', title: 'Design chat' }],
    }
  }) as ConvexReactClient['query']
  assert.deepEqual(await searchContext({ query }, 'workspace', 'design'), [
    { type: 'note', id: 'note', label: 'Design note' },
    { type: 'file', id: 'file', label: 'Design file' },
    { type: 'chat', id: 'chat', label: 'Design chat' },
  ])
})
