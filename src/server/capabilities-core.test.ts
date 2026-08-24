import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCapabilityDisabledError,
  getRequiredCapabilityForRoute,
} from './capabilities-core'

test('enterprise feature routes map to deterministic capabilities', () => {
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/browser-task'), 'browserUse')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/daytona/run'), 'sandboxes')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/integrations'), 'integrations')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/memory/search'), 'memory')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/knowledge/search'), 'vectorSearch')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/enrollment-sessions'), 'connectedAgents')
})

test('disabled capability payload uses stable machine-readable shape', () => {
  assert.deepEqual(getCapabilityDisabledError('browserUse'), {
    error: 'Browser use is disabled for this deployment.',
    code: 'capability_disabled',
    capability: 'browserUse',
  })
})
