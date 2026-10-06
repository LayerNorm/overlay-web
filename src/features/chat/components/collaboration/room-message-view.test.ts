import test from 'node:test'
import assert from 'node:assert/strict'

import { getDescriptiveToolLabel } from '@overlay/chat-core'
import { toRoomMessageView, type RoomMessageRecord } from './room-message-view'

function record(overrides: Partial<RoomMessageRecord> = {}): RoomMessageRecord {
  return {
    id: 'm1',
    turnId: 't1',
    authorKind: 'agent',
    authorPrincipalId: 'agent-1',
    content: 'done',
    createdAt: 1_000,
    ...overrides,
  }
}

test('agent messages derive workedDurationMs from createdAt→updatedAt', () => {
  const view = toRoomMessageView({
    message: record({ createdAt: 1_000, updatedAt: 44_000 }),
    currentPrincipalId: 'me',
    authorName: 'Fundraising Agent',
  })
  assert.equal(view.workedDurationMs, 43_000)
})

test('workedDurationMs is absent without a later updatedAt or for human messages', () => {
  assert.equal(
    toRoomMessageView({
      message: record({ createdAt: 1_000 }),
      currentPrincipalId: 'me',
      authorName: 'Agent',
    }).workedDurationMs,
    undefined,
  )
  assert.equal(
    toRoomMessageView({
      message: record({ createdAt: 5_000, updatedAt: 4_000 }),
      currentPrincipalId: 'me',
      authorName: 'Agent',
    }).workedDurationMs,
    undefined,
  )
  assert.equal(
    toRoomMessageView({
      message: record({ authorKind: 'human', authorPrincipalId: 'me', createdAt: 1_000, updatedAt: 9_000 }),
      currentPrincipalId: 'me',
      authorName: 'You',
    }).workedDurationMs,
    undefined,
  )
})

test('an agent-authored question carries who asked and how deep the chain is; a person cannot fake one', () => {
  const base = { id: 'm', createdAt: 1, content: 'Asked by Scout: hi', turnId: 't' }
  const lineage = { type: 'data-agent-lineage', data: { rootTurnId: 'r', hop: 2, chain: ['a', 'b'], askedByAgentId: 'a', askedByName: 'Scout', parentConversationId: 'room-1' } }
  const asked = toRoomMessageView({ message: { ...base, authorKind: 'agent', parts: [lineage] } as never, currentPrincipalId: 'me', authorName: 'Scout' })
  assert.deepEqual(asked.askedBy, { name: 'Scout', hop: 2, parentConversationId: 'room-1' })
  const forged = toRoomMessageView({ message: { ...base, authorKind: 'human', parts: [lineage] } as never, currentPrincipalId: 'me', authorName: 'Me' })
  assert.equal(forged.askedBy, undefined)
})

test('while a connected agent’s computer wakes up the row is a running "Connecting to computer" tool line, not stored text', () => {
  const view = toRoomMessageView({
    message: record({
      content: 'Waiting for overlay-cloud-5d291a64',
      parts: [
        { type: 'text', text: 'Waiting for overlay-cloud-5d291a64' },
        { type: 'data-remote-agent-status', data: { state: 'waiting', runId: 'run_1', environmentName: 'overlay-cloud-5d291a64', queueExpiresAt: 9 } },
      ],
    }),
    currentPrincipalId: 'me',
    authorName: 'Claude Code',
  })
  assert.deepEqual(view.blocks, [{ kind: 'tool', key: 'connect-computer', name: 'connect_computer', state: 'input-available' }])
  assert.equal(getDescriptiveToolLabel('connect_computer', undefined, 'running'), 'Connecting to computer')
  // Its controls (Cancel, Retry) are unchanged.
  assert.equal(view.remoteQueue?.environmentName, 'overlay-cloud-5d291a64')
})

test('once the agent starts working the connecting row is gone and the real content shows', () => {
  const view = toRoomMessageView({
    message: record({ content: 'Working on it', parts: [{ type: 'text', text: 'Working on it' }, { type: 'data-remote-agent-status', data: { state: 'running', runId: 'run_1', environmentName: 'e', queueExpiresAt: 9 } }] }),
    currentPrincipalId: 'me',
    authorName: 'Claude Code',
  })
  assert.equal(view.remoteQueue, undefined)
  assert.deepEqual(view.blocks, [{ kind: 'text', text: 'Working on it' }])
})

test('the transcript stops at a pending permission card and continues once it is answered', () => {
  const request = (state: string) => ({ type: 'data-remote-agent-request', data: { state, runId: 'run_1', requestKey: 'k1', kind: 'permission', prompt: 'Allow the command?' } })
  const parts = (state: string) => [
    { type: 'text', text: 'Let me run that.' },
    request(state),
    { type: 'text', text: 'It printed 3 lines.' },
  ]
  const blocks = (state: string) => toRoomMessageView({ message: record({ parts: parts(state) }), currentPrincipalId: 'me', authorName: 'Claude Code' }).blocks
  // Waiting: only what came before the card.
  assert.deepEqual(blocks('pending'), [{ kind: 'text', text: 'Let me run that.' }])
  // Answered: everything, in order.
  assert.deepEqual(blocks('resolved'), [{ kind: 'text', text: 'Let me run that.\n\nIt printed 3 lines.' }])
})
