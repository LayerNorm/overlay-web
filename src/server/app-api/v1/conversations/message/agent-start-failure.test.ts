import assert from 'node:assert/strict'
import test from 'node:test'
import { agentStartFailureClass, agentStartFailureMessage } from './agent-start-failure'

test('agent-start failures expose safe recovery guidance without leaking server errors', () => {
  assert.equal(agentStartFailureClass(new Error('AGENT_ENVIRONMENT_OFFLINE')), 'host_offline')
  assert.equal(
    agentStartFailureMessage('Hermes', new Error('AGENT_ENVIRONMENT_OFFLINE')),
    'Hermes could not start because its connected environment is offline. Reconnect the environment, then send this message again.',
  )
  assert.equal(agentStartFailureClass(new Error('database secret detail')), 'start_failed')
  assert.equal(
    agentStartFailureMessage('Hermes', new Error('database secret detail')),
    'Hermes could not start this turn. Your message was saved; please try sending it again.',
  )
})
