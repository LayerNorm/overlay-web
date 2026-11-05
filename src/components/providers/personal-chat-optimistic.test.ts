import assert from 'node:assert/strict'
import test from 'node:test'
import { updatePersonalChatRow } from './personal-chat-optimistic'

type Row = {
  _id: string
  title: string
  lastModified: number
}

test('rejecting an older rename preserves newer intent and unrelated remote rows', () => {
  const initial: Row[] = [
    { _id: 'chat-a', title: 'Original', lastModified: 1 },
    { _id: 'chat-b', title: 'Other', lastModified: 2 },
  ]
  const olderOptimistic = updatePersonalChatRow(initial, 'chat-a', (row) => ({
    ...row,
    title: 'Older rename',
  }))
  const newerOptimistic = updatePersonalChatRow(olderOptimistic, 'chat-a', (row) => ({
    ...row,
    title: 'Newer rename',
  }))
  const serverStateAfterOlderFailure: Row[] = [
    { _id: 'chat-a', title: 'Original', lastModified: 1 },
    { _id: 'chat-b', title: 'Remote update', lastModified: 3 },
  ]
  const rebasedNewerIntent = updatePersonalChatRow(serverStateAfterOlderFailure, 'chat-a', (row) => ({
    ...row,
    title: newerOptimistic.find((candidate) => candidate._id === 'chat-a')!.title,
  }))

  assert.equal(rebasedNewerIntent.find((row) => row._id === 'chat-a')?.title, 'Newer rename')
  assert.deepEqual(rebasedNewerIntent.find((row) => row._id === 'chat-b'), {
    _id: 'chat-b',
    title: 'Remote update',
    lastModified: 3,
  })
})
