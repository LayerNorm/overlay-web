import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentMessages, buildRoomContext, CLOSED_AGENT_TURN_NOTE } from './agent-turn-context'

const participants = [
  { displayName: 'Divyansh', principalId: 'human-1', principalType: 'human' as const },
  { displayName: 'Overlay', principalId: 'agent-1', principalType: 'agent' as const },
  { displayName: 'Researcher', principalId: 'agent-2', principalType: 'agent' as const },
]

test('the agent reads its own past messages as its own', () => {
  const messages = buildAgentMessages({
    agentPrincipalId: 'agent-1',
    history: [
      { _id: 'm1', authorKind: 'human', authorPrincipalId: 'human-1', content: 'hello' },
      { _id: 'm2', authorKind: 'agent', authorPrincipalId: 'agent-1', content: 'hi there' },
    ],
    participants,
  })
  assert.deepEqual(messages, [
    { role: 'user', content: 'Divyansh: hello' },
    { role: 'assistant', content: 'hi there' },
  ])
})

test('another agent in the room is not mistaken for this agent', () => {
  const messages = buildAgentMessages({
    agentPrincipalId: 'agent-1',
    history: [{ _id: 'm1', authorKind: 'agent', authorPrincipalId: 'agent-2', content: 'found it' }],
    participants,
  })
  assert.deepEqual(messages, [{ role: 'user', content: 'Researcher: found it' }])
})

test('deleted and empty messages never reach the model', () => {
  const messages = buildAgentMessages({
    agentPrincipalId: 'agent-1',
    history: [
      { _id: 'm1', authorKind: 'human', authorPrincipalId: 'human-1', content: 'gone', deletedAt: 1 },
      { _id: 'm2', authorKind: 'human', authorPrincipalId: 'human-1', content: '   ' },
      { _id: 'm3', authorKind: 'human', authorPrincipalId: 'human-1', content: 'kept' },
    ],
    participants,
  })
  assert.deepEqual(messages, [{ role: 'user', content: 'Divyansh: kept' }])
})

test('an earlier failed agent turn is marked closed even when it has an error message', () => {
  const messages = buildAgentMessages({
    agentPrincipalId: 'agent-1',
    history: [
      { _id: 'm1', authorKind: 'agent', authorPrincipalId: 'agent-1', content: 'Provider failed.', status: 'error' },
    ],
    participants,
  })
  assert.deepEqual(messages, [{ role: 'assistant', content: CLOSED_AGENT_TURN_NOTE }])
})

test('an empty completed agent turn is marked closed and an empty generating turn is dropped', () => {
  const messages = buildAgentMessages({
    agentPrincipalId: 'agent-1',
    history: [
      { _id: 'm1', authorKind: 'agent', authorPrincipalId: 'agent-1', content: '', status: 'completed' },
      { _id: 'm2', authorKind: 'agent', authorPrincipalId: 'agent-1', content: '  ', status: 'generating' },
    ],
    participants,
  })
  assert.deepEqual(messages, [{ role: 'assistant', content: CLOSED_AGENT_TURN_NOTE }])
})

test('the current message closes the transcript to later self-authored turns only', () => {
  const messages = buildAgentMessages({
    agentPrincipalId: 'agent-1',
    currentMessageId: 'trigger',
    history: [
      { _id: 'before', authorKind: 'agent', authorPrincipalId: 'agent-1', content: 'Earlier reply' },
      { _id: 'trigger', authorKind: 'human', authorPrincipalId: 'human-1', content: 'Current request' },
      { _id: 'self-after', authorKind: 'agent', authorPrincipalId: 'agent-1', content: 'Later reply' },
      { _id: 'human-after', authorKind: 'human', authorPrincipalId: 'human-1', content: 'New room message' },
    ],
    participants,
  })
  assert.deepEqual(messages, [
    { role: 'assistant', content: 'Earlier reply' },
    { role: 'user', content: 'Divyansh: Current request' },
    { role: 'user', content: 'Divyansh: New room message' },
  ])
})

test('an unknown author still gets a name rather than an empty prefix', () => {
  const messages = buildAgentMessages({
    agentPrincipalId: 'agent-1',
    history: [{ _id: 'm1', authorKind: 'human', authorPrincipalId: 'ghost', content: 'who am i' }],
    participants,
  })
  assert.deepEqual(messages, [{ role: 'user', content: 'Teammate: who am i' }])
})

test('history is capped so a long room cannot crowd out the turn', () => {
  const history = Array.from({ length: 60 }, (_, index) => ({
    _id: `m${index}`,
    authorKind: 'human' as const,
    authorPrincipalId: 'human-1',
    content: `message ${index}`,
  }))
  const messages = buildAgentMessages({ agentPrincipalId: 'agent-1', history, participants })
  assert.equal(messages.length, 24)
  assert.equal(messages.at(-1)?.content, 'Divyansh: message 59')
})

test('room context names the agent itself in the roster', () => {
  const context = buildRoomContext({
    agentName: 'Overlay',
    agentPrincipalId: 'agent-1',
    conversationTitle: 'design',
    conversationType: 'channel',
    participants,
  })
  assert.match(context, /the #design channel/)
  assert.match(context, /- Overlay — agent \(you\)/)
  assert.match(context, /- Divyansh — human$/m)
})

test('a large roster is truncated rather than dumped', () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    displayName: `Member ${index}`,
    principalId: `human-${index}`,
    principalType: 'human' as const,
  }))
  const context = buildRoomContext({
    agentName: 'Overlay',
    agentPrincipalId: 'agent-1',
    conversationType: 'dm',
    participants: many,
  })
  assert.match(context, /\[20 more participants omitted\]/)
})
