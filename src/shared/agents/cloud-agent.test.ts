import assert from 'node:assert/strict'
import test from 'node:test'
import { cloudCreateProgress, deriveCloudAgentState } from './cloud-agent'

const provision = (phase: 'queued' | 'allocating' | 'booting' | 'connecting' | 'ready' | 'failed', error?: string) =>
  ({ phase, updatedAt: 1, ...(error ? { error } : {}) })

test('the create dialog does not finish when provisioning does: it waits for the host to check in', () => {
  // Provisioning is done but the machine's host is not online yet: the agent is still starting.
  const waiting = cloudCreateProgress({ state: 'starting', provision: provision('ready') })
  assert.deepEqual(waiting, { phase: 'connecting', error: null, done: false })
  assert.deepEqual(cloudCreateProgress({ state: 'ready', provision: provision('ready') }), { phase: 'ready', error: null, done: true })
})

test('the dialog follows each phase, starts at the beginning with no record, and reports a failure once', () => {
  for (const phase of ['queued', 'allocating', 'booting', 'connecting'] as const) {
    assert.deepEqual(cloudCreateProgress({ state: 'starting', provision: provision(phase) }), { phase, error: null, done: false })
  }
  assert.equal(cloudCreateProgress({ state: 'unavailable', provision: null }).phase, 'queued')
  assert.deepEqual(cloudCreateProgress({ state: 'failed', provision: provision('failed', 'Could not start the machine. Try again.') }),
    { phase: 'failed', error: 'Could not start the machine. Try again.', done: false })
})

test('the agent page reports starting while the host is offline and ready once it is online', () => {
  const base = { provision: provision('ready'), machine: { state: 'running' as const }, account: null }
  assert.equal(deriveCloudAgentState({ ...base, environment: { id: 'e', status: 'offline', createdAt: 1 } }), 'starting')
  assert.equal(deriveCloudAgentState({ ...base, environment: { id: 'e', status: 'online', createdAt: 1 } }), 'ready')
})
