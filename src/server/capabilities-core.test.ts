import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCapabilityDisabledError,
  getRequiredCapabilityForRoute,
} from './capabilities-core'

test('enterprise feature routes map to deterministic capabilities', () => {
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/browser-task'), 'browserUse')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/integrations'), 'integrations')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/providers/connections/test'), 'modelRouting')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/memory/search'), 'memory')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/knowledge/search'), 'vectorSearch')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/enrollment-sessions'), 'externalAgents')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/agent-environments'), null)
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/agent-environments/env/commands'), null)
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/env/events'), null)
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/env/commands/cmd/ack'), null)
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/env/approve'), 'externalAgents')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/cloud'), 'externalAgents')
  assert.equal(getRequiredCapabilityForRoute('PUT', '/api/v1/agent-bindings'), 'externalAgents')
  assert.equal(getRequiredCapabilityForRoute('DELETE', '/api/v1/agent-bindings'), null)
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/computers'), 'computers')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/computers/cmp_1/desktop'), 'computers')
})

test('disabled capability payload uses stable machine-readable shape', () => {
  assert.deepEqual(getCapabilityDisabledError('browserUse'), {
    error: 'Browser use is disabled for this deployment.',
    code: 'capability_disabled',
    capability: 'browserUse',
  })
})
