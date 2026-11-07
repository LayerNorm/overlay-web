import assert from 'node:assert/strict'
import test from 'node:test'
import { categorizeCollaborationUnreadNotifications } from './notification-badges'

test('categorizes unread collaboration notifications by the room type they carry', () => {
  const counts = categorizeCollaborationUnreadNotifications([
    { conversationType: 'dm' },
    { conversationType: 'dm' },
    { conversationType: 'channel' },
    { conversationType: 'personal' },
    {},
  ])

  assert.deepEqual(counts, { dms: 2, channels: 1, total: 5 })
})
