import assert from 'node:assert/strict'
import test from 'node:test'
import { validateApiClientBoundary } from './api-boundary'

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

test('agent accounts and cloud machines accept supported providers only', () => {
  for (const provider of ['claude-code', 'codex']) {
    assert.doesNotThrow(() => {
      validateApiClientBoundary({
        path: '/api/v1/provider-accounts',
        method: 'POST',
        body: { provider, method: 'api_key', secret: 'sk-test-secret-value' },
      })
      validateApiClientBoundary({
        path: '/api/v1/agent-environments/cloud',
        method: 'POST',
        body: { agentId: 'a1', adapterId: provider, providerAccountId: 'acc1' },
      })
    }, provider)
  }

  for (const provider of ['opencode', 'hermes', 'cursor']) {
    assert.throws(() => validateApiClientBoundary({
      path: '/api/v1/provider-accounts',
      method: 'POST',
      body: { provider, method: 'api_key', secret: 'sk-test-secret-value' },
    }), /Invalid POST \/api\/v1\/provider-accounts body: Invalid enum value/)
    assert.throws(() => validateApiClientBoundary({
      path: '/api/v1/agent-environments/cloud',
      method: 'POST',
      body: { agentId: 'a1', adapterId: provider, providerAccountId: 'acc1' },
    }), /Invalid POST \/api\/v1\/agent-environments\/cloud body: Invalid enum value/)
  }
})
