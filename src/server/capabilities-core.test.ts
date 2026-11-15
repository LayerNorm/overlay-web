import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCapabilityDisabledError,
  getRequiredCapabilityForRoute,
} from './capabilities-core'

test('enterprise feature routes map to deterministic capabilities', () => {
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/computers'), 'computers')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/integrations'), 'integrations')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/providers/connections/test'), 'modelRouting')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/memory/search'), 'memory')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/knowledge/search'), 'vectorSearch')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/enrollment-sessions'), 'computers')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/agent-environments'), null)
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/agent-environments/env/local-tool-calls'), null)
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/env/local-tool-calls/call/result'), null)
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/env/heartbeat'), null)
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/agent-environments/env/approve'), 'computers')
  assert.equal(getRequiredCapabilityForRoute('POST', '/api/v1/computers'), 'computers')
  assert.equal(getRequiredCapabilityForRoute('GET', '/api/v1/computers/cmp_1/desktop'), 'computers')
})

test('disabled capability payload uses stable machine-readable shape', () => {
  assert.deepEqual(getCapabilityDisabledError('computers'), {
    error: 'Computers is disabled for this deployment.',
    code: 'capability_disabled',
    capability: 'computers',
  })
})
