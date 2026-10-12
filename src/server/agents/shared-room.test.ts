import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSharedRoom } from './shared-room'

const base = { actorUserId: 'user_1', conversationId: 'c1', workspaceId: 'ws_1' }
const human = { principalType: 'human' as const }
const agent = { principalType: 'agent' as const }

function collaboration(conversation: Record<string, unknown> | null, participants: Array<{ principalType: 'human' | 'agent' }>) {
  return {
    getAccessibleConversation: async () => conversation,
    listParticipants: async () => participants,
  } as never
}

test('a chat between one person and an agent is not a shared room', async () => {
  assert.equal(await resolveSharedRoom({ ...base, collaboration: collaboration({ conversationType: 'dm' }, [human, agent]) }), false)
})

test('a public channel, and any room with two people, is shared', async () => {
  assert.equal(await resolveSharedRoom({ ...base, collaboration: collaboration({ conversationType: 'channel', channelVisibility: 'public' }, [human, agent]) }), true)
  assert.equal(await resolveSharedRoom({ ...base, collaboration: collaboration({ conversationType: 'dm' }, [human, human, agent]) }), true)
})

test('a private channel with one person is not shared', async () => {
  assert.equal(await resolveSharedRoom({ ...base, collaboration: collaboration({ conversationType: 'channel', channelVisibility: 'private' }, [human, agent]) }), false)
})

test('when the room cannot be read the answer is shared, the safe side', async () => {
  assert.equal(await resolveSharedRoom({ ...base, collaboration: collaboration(null, []) }), true)
  const failing = { getAccessibleConversation: async () => { throw new Error('down') }, listParticipants: async () => [] } as never
  assert.equal(await resolveSharedRoom({ ...base, collaboration: failing }), true)
})
