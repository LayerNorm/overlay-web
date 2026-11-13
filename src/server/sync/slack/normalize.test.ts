import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandSlackEntities, normalizeSlackSyncEvent, slackMentionedUserIds } from './normalize'

const envelope = (event: Record<string, unknown>) => JSON.stringify({ type: 'event_callback', team_id: 'T1', event })

test('a new channel message becomes an upsert keyed by its ts', () => {
  const result = normalizeSlackSyncEvent(envelope({ type: 'message', channel: 'C1', user: 'U1', text: 'hi', ts: '1700000000.000100' }))
  assert.deepEqual(result, {
    teamId: 'T1',
    channelId: 'C1',
    userIds: ['U1'],
    events: [{ kind: 'message.upsert', externalMessageId: '1700000000.000100', externalUserId: 'U1', text: 'hi', createdAt: 1700000000000 }],
  })
})

test('thread replies carry their root, and roots do not point at themselves', () => {
  const reply = normalizeSlackSyncEvent(envelope({ type: 'message', channel: 'C1', user: 'U1', text: 'r', ts: '2.0', thread_ts: '1.0' }))
  assert.equal((reply?.events[0] as { externalThreadId?: string }).externalThreadId, '1.0')
  const root = normalizeSlackSyncEvent(envelope({ type: 'message', channel: 'C1', user: 'U1', text: 'r', ts: '1.0', thread_ts: '1.0' }))
  assert.equal('externalThreadId' in (root?.events[0] ?? {}), false)
})

test('edits, deletes and reactions map to their sync events', () => {
  const edit = normalizeSlackSyncEvent(envelope({
    type: 'message', subtype: 'message_changed', channel: 'C1', ts: '9.0',
    message: { user: 'U1', text: 'new', ts: '1.0', edited: { ts: '5.0' } },
  }))
  assert.deepEqual(edit?.events, [{ kind: 'message.upsert', externalMessageId: '1.0', externalUserId: 'U1', text: 'new', createdAt: 1000, editedAt: 5000 }])
  const deleted = normalizeSlackSyncEvent(envelope({ type: 'message', subtype: 'message_deleted', channel: 'C1', deleted_ts: '1.0' }))
  assert.deepEqual(deleted?.events, [{ kind: 'message.delete', externalMessageId: '1.0' }])
  const reaction = normalizeSlackSyncEvent(envelope({ type: 'reaction_added', user: 'U2', reaction: 'tada', item: { type: 'message', channel: 'C1', ts: '1.0' } }))
  assert.deepEqual(reaction, { teamId: 'T1', channelId: 'C1', userIds: ['U2'], events: [{ kind: 'reaction.add', externalMessageId: '1.0', externalUserId: 'U2', emoji: 'tada' }] })
})

test('joins, tombstones, app events and malformed bodies are ignored', () => {
  assert.equal(normalizeSlackSyncEvent(envelope({ type: 'message', subtype: 'channel_join', channel: 'C1', user: 'U1', ts: '1.0' })), null)
  assert.equal(normalizeSlackSyncEvent(envelope({ type: 'message', subtype: 'message_changed', channel: 'C1', message: { subtype: 'tombstone', ts: '1.0' } })), null)
  assert.equal(normalizeSlackSyncEvent(envelope({ type: 'app_mention', channel: 'C1', user: 'U1', ts: '1.0' })), null)
  assert.equal(normalizeSlackSyncEvent('not json'), null)
  assert.equal(normalizeSlackSyncEvent(JSON.stringify({ type: 'url_verification', challenge: 'x' })), null)
})

test('mentions expand to readable names before conversion', () => {
  const text = 'hey <@U1> and <@U2|bob>, see <#C9|general> <!here> <!subteam^S1|@eng>'
  assert.deepEqual(slackMentionedUserIds(text), ['U1', 'U2'])
  assert.equal(expandSlackEntities(text, new Map([['U1', 'Alice']])), 'hey @Alice and @bob, see #general @here @eng')
})
