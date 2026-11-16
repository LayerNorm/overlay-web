import assert from 'node:assert/strict'
import test from 'node:test'
import { getApiBoundarySchema, validateApiClientBoundary } from './api-boundary'

test('automation run boundary accepts Convex scheduled runner payloads', () => {
  assert.doesNotThrow(() => {
    validateApiClientBoundary({
      path: '/api/v1/automations/run',
      method: 'POST',
      body: { runId: 'run_1' },
    })
  })
})

test('automation run boundary rejects missing run IDs', () => {
  assert.throws(
    () => {
      validateApiClientBoundary({
        path: '/api/v1/automations/run',
        method: 'POST',
        body: {},
      })
    },
    /Invalid POST \/api\/v1\/automations\/run body: Required/,
  )
})

test('removed connected-agent routes are excluded from API boundary schemas', () => {
  assert.equal(getApiBoundarySchema('/api/v1/agent-environments/cloud', 'POST'), undefined)
  assert.equal(getApiBoundarySchema('/api/v1/provider-accounts', 'POST'), undefined)
  assert.equal(getApiBoundarySchema('/api/v1/agent-environments/{environmentId}/events', 'POST'), undefined)
})

test('scope request parsing preserves native task activity attribution', () => {
  const schema = getApiBoundarySchema('/api/v1/scope', 'POST')?.json
  assert.ok(schema)
  for (const action of ['archive', 'restore', 'move']) {
    const body = { resource: 'work', id: 'task1', action, actingAgentPrincipalId: 'p-agent',
      ...(action === 'move' ? { to: 'workspace' } : {}) }
    assert.deepEqual(schema.parse(body), body)
  }
})
