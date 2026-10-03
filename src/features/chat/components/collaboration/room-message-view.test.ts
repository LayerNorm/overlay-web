import test from 'node:test'
import assert from 'node:assert/strict'

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
  const lineage = { type: 'data-agent-lineage', data: { rootTurnId: 'r', hop: 2, chain: ['a', 'b'], askedByAgentId: 'a', askedByName: 'Scout' } }
  const asked = toRoomMessageView({ message: { ...base, authorKind: 'agent', parts: [lineage] } as never, currentPrincipalId: 'me', authorName: 'Scout' })
  assert.deepEqual(asked.askedBy, { name: 'Scout', hop: 2 })
  const forged = toRoomMessageView({ message: { ...base, authorKind: 'human', parts: [lineage] } as never, currentPrincipalId: 'me', authorName: 'Me' })
  assert.equal(forged.askedBy, undefined)
})
