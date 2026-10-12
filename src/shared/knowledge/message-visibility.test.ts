import assert from 'node:assert/strict'
import test from 'node:test'
import { canRecallMessageChunk, messageChunkVisibility } from './message-visibility'

test('only a public channel is shared with the workspace; everything else stays with its author', () => {
  assert.equal(messageChunkVisibility({ conversationType: 'channel', channelVisibility: 'public' }), 'workspace')
  assert.equal(messageChunkVisibility({ conversationType: 'channel', channelVisibility: 'private' }), 'owner')
  assert.equal(messageChunkVisibility({ conversationType: 'channel' }), 'owner')
  assert.equal(messageChunkVisibility({ conversationType: 'dm' }), 'owner')
  assert.equal(messageChunkVisibility({ conversationType: 'personal' }), 'owner')
  // Older personal chats carry no type at all.
  assert.equal(messageChunkVisibility({}), 'owner')
  assert.equal(messageChunkVisibility(null), 'owner')
  assert.equal(messageChunkVisibility(undefined), 'owner')
})

test('a teammate recalls only the public-channel messages; the author recalls their own anywhere', () => {
  const chunk = (conversation: Parameters<typeof canRecallMessageChunk>[0]['conversation'], viewerUserId = 'bob') =>
    canRecallMessageChunk({ viewerUserId, chunkUserId: 'alice', conversation })
  assert.equal(chunk({ conversationType: 'personal' }), false)
  assert.equal(chunk({ conversationType: 'dm' }), false)
  assert.equal(chunk({ conversationType: 'channel', channelVisibility: 'private' }), false)
  assert.equal(chunk(null), false)
  assert.equal(chunk({ conversationType: 'channel', channelVisibility: 'public' }), true)
  assert.equal(chunk({ conversationType: 'personal' }, 'alice'), true)
})
