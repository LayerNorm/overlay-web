import assert from 'node:assert/strict'
import test from 'node:test'
import { categorizeCollaborationUnreadNotifications } from './notification-badges'

test('categorizes unread collaboration notifications by conversation type', () => {
  const counts = categorizeCollaborationUnreadNotifications(
    [
      { conversationId: 'dm-1' },
      { conversationId: 'dm-1' },
      { conversationId: 'channel-1' },
      { conversationId: 'not-in-first-page' },
      {},
    ],
    [
      { _id: 'dm-1', conversationType: 'dm' },
      { _id: 'channel-1', conversationType: 'channel' },
    ],
  )

  assert.deepEqual(counts, { dms: 2, channels: 1, total: 5 })
})
