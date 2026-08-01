import assert from 'node:assert/strict'
import test from 'node:test'
import { selectRecentConversationMessages } from './recent-conversation-messages'

type Message = {
  _id: string
  turnId: string
  role: 'user' | 'assistant'
  authorKind: 'human' | 'agent' | 'model'
  clientNonce?: string
  createdAt: number
}

test('retains independently keyed agent replies for the selected human turn', () => {
  const messages: Message[] = [
    {
      _id: 'agent-new',
      turnId: 'agent_turn_new',
      role: 'assistant',
      authorKind: 'agent',
      clientNonce: 'agent:user-new:bagel',
      createdAt: 40,
    },
    {
      _id: 'model-new',
      turnId: 'turn-new',
      role: 'assistant',
      authorKind: 'model',
      createdAt: 30,
    },
    {
      _id: 'user-new',
      turnId: 'turn-new',
      role: 'user',
      authorKind: 'human',
      createdAt: 20,
    },
    {
      _id: 'agent-old',
      turnId: 'agent_turn_old',
      role: 'assistant',
      authorKind: 'agent',
      clientNonce: 'agent:user-old:bagel',
      createdAt: 15,
    },
    {
      _id: 'user-old',
      turnId: 'turn-old',
      role: 'user',
      authorKind: 'human',
      createdAt: 10,
    },
  ]

  assert.deepEqual(
    selectRecentConversationMessages(messages, 1).map((message) => message._id),
    ['user-new', 'model-new', 'agent-new'],
  )
})

test('does not include unrelated or malformed agent responses', () => {
  const messages: Message[] = [
    {
      _id: 'unrelated-agent',
      turnId: 'agent_turn_other',
      role: 'assistant',
      authorKind: 'agent',
      clientNonce: 'agent:user-other:bagel',
      createdAt: 30,
    },
    {
      _id: 'malformed-agent',
      turnId: 'agent_turn_malformed',
      role: 'assistant',
      authorKind: 'agent',
      clientNonce: 'agent-response',
      createdAt: 25,
    },
    {
      _id: 'user-new',
      turnId: 'turn-new',
      role: 'user',
      authorKind: 'human',
      createdAt: 20,
    },
  ]

  assert.deepEqual(
    selectRecentConversationMessages(messages, 1).map((message) => message._id),
    ['user-new'],
  )
})
