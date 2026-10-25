import test from 'node:test'
import assert from 'node:assert/strict'

import { getDescriptiveToolLabel } from '@overlay/chat-core'
import { isRoomAgentResponding, mergeRoomMessages, toRoomMessageView, type RoomMessageRecord } from './room-message-view'

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

test('questionnaires stay busy through pending and persisted agent generation, then unlock', () => {
  assert.equal(isRoomAgentResponding([], 'Overlay'), true)
  assert.equal(isRoomAgentResponding([record({ status: 'generating' })], null), true)
  assert.equal(isRoomAgentResponding([record({ status: 'completed' })], null), false)
  assert.equal(isRoomAgentResponding([record({ status: 'error' })], null), false)
  assert.equal(isRoomAgentResponding([record({ authorKind: 'human' })], null), false)
  assert.equal(isRoomAgentResponding([], null), false)
})

test('saved drive summaries retain file links separately from the provider answer and reject malformed paths', () => {
  const status = { state: 'saved', fileCount: 1, folderCount: 0,
    entries: [{ fileId: 'report', path: 'reports/result.md', kind: 'file' }] }
  const view = (data: Record<string, unknown>) => toRoomMessageView({ message: record({
    content: '# Result', parts: [{ type: 'text', text: '# Result' }, { type: 'data-remote-agent-drive', data }],
  }), currentPrincipalId: 'me', authorName: 'Agent' })
  const saved = view({ ...status, key: 'drive' })
  assert.deepEqual(saved.remoteDrive, status)
  assert.equal(saved.text, '# Result')
  assert.deepEqual(saved.blocks, [{ kind: 'text', text: '# Result' }])
  assert.equal(view({ ...status, entries: [{ fileId: 'report', path: '../private', kind: 'file' }] }).remoteDrive, undefined)
})

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
  // The queue identity remains available while the hover toolbar handles cancellation.
  assert.equal(view.remoteQueue?.environmentName, 'overlay-cloud-5d291a64')
})

test('a connection timeout replaces stored waiting text with a failed connection, then reconnects on retry', () => {
  for (const state of ['recoverable', 'recovering']) {
    const view = toRoomMessageView({
      message: record({ content: 'Waiting for Computer', parts: [
        { type: 'text', text: 'Waiting for Computer' },
        { type: 'data-remote-agent-status', data: { state, runId: 'run-1', environmentName: 'Computer', retryable: true } },
      ] }), currentPrincipalId: 'me', authorName: 'Claude Code',
    })
    assert.deepEqual(view.blocks, [{ kind: 'tool', key: 'connect-computer', name: 'connect_computer',
      state: state === 'recoverable' ? 'output-error' : 'input-available' }])
  }
  assert.equal(getDescriptiveToolLabel('connect_computer', undefined, 'error'), 'Computer connection failed')
})

test('a recoverable failure after work starts preserves the actual output', () => {
  const view = toRoomMessageView({ message: record({ content: 'Finished inspecting', parts: [
    { type: 'text', text: 'Finished inspecting' },
    { type: 'data-remote-agent-status', data: { state: 'recoverable', runId: 'run-1', environmentName: 'Computer', retryable: true } },
  ] }), currentPrincipalId: 'me', authorName: 'Claude Code' })
  assert.deepEqual(view.blocks, [{ kind: 'text', text: 'Finished inspecting' }])
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

test('an older HTTP snapshot cannot overwrite committed subscription output after reconnect', () => {
  const base = { id: 'reply', turnId: 'turn', authorKind: 'agent' as const, createdAt: 1 }
  const snapshot = { ...base, content: 'Earlier', updatedAt: 10, eventSequence: 2 }
  const committed = { ...base, content: '**Finished**', updatedAt: 20, eventSequence: 3, status: 'completed' as const }
  assert.equal(mergeRoomMessages([snapshot], [committed])[0]?.content, '**Finished**')
  assert.equal(mergeRoomMessages([committed], [snapshot])[0]?.content, '**Finished**')
})

test('a newer HTTP completion without an event sequence supersedes an older live row', () => {
  const base = { id: 'reply', turnId: 'turn', authorKind: 'agent' as const, createdAt: 1 }
  const live = { ...base, content: 'Working', updatedAt: 10, eventSequence: 3 }
  const completed = { ...base, content: 'Finished', updatedAt: 20, status: 'completed' as const }
  assert.equal(mergeRoomMessages([completed], [live])[0]?.status, 'completed')
  assert.equal(mergeRoomMessages([live], [completed])[0]?.status, 'completed')
})

test('same-millisecond reconnect snapshots cannot regress a terminal row to generating', () => {
  const base = { id: 'reply', turnId: 'turn', authorKind: 'agent' as const, createdAt: 1, updatedAt: 10 }
  const snapshot = { ...base, content: 'Working', status: 'generating' as const }
  const committed = { ...base, content: 'Done', status: 'completed' as const }
  assert.equal(mergeRoomMessages([snapshot], [committed])[0]?.status, 'completed')
})


test('generating native agent messages show text around tool parts exactly once', () => {
  const view = toRoomMessageView({
    message: record({
      status: 'generating',
      content: 'Before toolAfter tool',
      parts: [
        { type: 'text', text: 'Before tool' },
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'one', toolName: 'search', state: 'output-available', toolOutput: {} } },
        { type: 'text', text: 'After tool' },
      ],
    }),
    currentPrincipalId: 'me', authorName: 'Agent',
  })
  assert.equal(view.streaming, true)
  assert.deepEqual(view.blocks.map((block) => block.kind), ['text', 'tool', 'text'])
  assert.deepEqual(view.blocks.filter((block) => block.kind === 'text').map((block) => block.text), ['Before tool', 'After tool'])
})
