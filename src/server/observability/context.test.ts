import assert from 'node:assert/strict'
import test from 'node:test'
import { contextForRequest, getObservabilityContext, withObservabilityContext } from './context'

test('observability context carries only sanitized correlation fields', async () => {
  const request = new Request('https://overlay.test/api/v1/files/file_1?token=secret', {
    headers: { 'x-request-id': 'request_1' },
  })

  await withObservabilityContext(
    contextForRequest(request, {
      provider: 'stripe',
      runId: 'run_1',
      tenantId: 'tenant_1',
    }),
    async () => {
      const context = getObservabilityContext()
      assert.equal(context.route, '/api/v1/files/:id')
      assert.equal(context.requestId, 'request_1')
      assert.equal(context.tenantId, 'tenant_1')
      assert.equal(context.runId, 'run_1')
      assert.equal(context.provider, 'stripe')
    },
  )
})

test('observability context excludes user-controlled contact data', () => {
  const context = contextForRequest(
    new Request('https://overlay.test/api/v1/files/person@example.com?code=secret', {
      headers: { 'x-request-id': 'person@example.com' },
    }),
    { tenantId: 'person@example.com' },
  )

  assert.equal(context.requestId, undefined)
  assert.equal(context.tenantId, undefined)
  assert.equal(context.route, '/api/v1/files/:id')
})
