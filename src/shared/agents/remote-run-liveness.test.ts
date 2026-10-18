import assert from 'node:assert/strict'
import test from 'node:test'
import { recordRemoteRunLiveness, remoteRunLivenessLabel } from './remote-run-liveness'
import type { AgentRemoteEvent } from '@overlay/workspace-contracts'
const heartbeat: AgentRemoteEvent = { protocolVersion: 1, eventId: 'h', environmentId: 'e', runId: 'r', sourceSequence: 1,
  occurredAt: 1000, type: 'heartbeat', payload: { quietMs: 180000, openTools: [{ actionId: 'web', title: 'Web search', runningMs: 180000 }], stalled: false } }
test('a three-minute quiet tool with a fresh heartbeat remains explicitly running', () => {
  const liveness = recordRemoteRunLiveness(undefined, [heartbeat], 200000)
  assert.ok(liveness); assert.equal(liveness.stalled, false)
  assert.equal(remoteRunLivenessLabel(liveness, 202000), 'Running Web search · 182s')
})
test('the status line keeps shell bodies collapsed and bounds long Unicode titles', () => {
  const liveness = recordRemoteRunLiveness(undefined, [heartbeat], 200000)
  assert.ok(liveness)
  const label = (title: string) => remoteRunLivenessLabel({...liveness, openTools: [{actionId: 'shell', title, runningMs: 1000}]}, 200000)
  assert.equal(label('python3 - <<\'PY\'\nprint("long shell body")\nPY'), "Running python3 - <<'PY' · 1s")
  assert.equal(label('🪐'.repeat(100)), `Running ${'🪐'.repeat(96)}… · 1s`)
  assert.equal(label(''), 'Running tool · 1s')
})
test('terminal output clears tools and observation alone does not invent progress', () => {
  const previous = recordRemoteRunLiveness(undefined, [heartbeat], 200000)
  assert.equal(recordRemoteRunLiveness(previous, [{ ...heartbeat, type: 'process_observation', payload: { process: 'live' } }], 205000), previous)
  const done = recordRemoteRunLiveness(previous, [{ ...heartbeat, type: 'completed', payload: {} }], 210000)
  assert.deepEqual(done?.openTools, []); assert.equal(done?.quietMs, 0)
})

test('missing heartbeats are distinguished from quiet output on a live tool', () => {
  const liveness = recordRemoteRunLiveness(undefined, [heartbeat], 200000)
  assert.ok(liveness)
  assert.match(remoteRunLivenessLabel(liveness, 240000), /Waiting for agent connection/)
})

test('a Stop confirmed by process observation clears stale tool liveness', () => {
  const previous = recordRemoteRunLiveness(undefined, [heartbeat], 200000)
  const observed: AgentRemoteEvent = { ...heartbeat, type: 'process_observation', payload: { process: 'missing', confidence: 'confirmed' } }
  assert.equal(recordRemoteRunLiveness(previous, [observed], 205000), previous)
  const stopped = recordRemoteRunLiveness(previous, [observed], 205000, true)
  assert.deepEqual(stopped?.openTools, [])
  assert.equal(stopped?.quietMs, 0)
  assert.equal(stopped?.stalled, false)
  assert.equal(stopped?.lastActivityAt, previous?.lastActivityAt)
})

test('ongoing legacy checkpoint output proves connection health without negotiated heartbeats', () => {
  const checkpoint: AgentRemoteEvent = { ...heartbeat, type: 'text_checkpoint', payload: { text: 'Working' } }
  const first = recordRemoteRunLiveness(undefined, [checkpoint], 1000)
  const later = recordRemoteRunLiveness(first, [checkpoint], 120000)
  assert.ok(later)
  assert.equal(remoteRunLivenessLabel(later, 122000), 'Working · last update 2s ago')
})

test('tool events update the label immediately and retain elapsed age across intervening text', () => {
  const action: AgentRemoteEvent = { ...heartbeat, type: 'action', payload: { actionId: 'search', title: 'Search', status: 'started' } }
  const start = recordRemoteRunLiveness(undefined, [action], 1000)
  const text = recordRemoteRunLiveness(start, [{ ...heartbeat, type: 'text_delta', payload: { offset: 0, text: 'x' } }], 11000)
  assert.ok(text)
  assert.equal(remoteRunLivenessLabel(text, 13000), 'Running Search · 12s')
  const done = recordRemoteRunLiveness(text, [{ ...action, payload: { ...action.payload, status: 'completed' } }], 14000)
  assert.ok(done)
  assert.equal(remoteRunLivenessLabel(done, 14000), 'Working · last update 0s ago')
})
