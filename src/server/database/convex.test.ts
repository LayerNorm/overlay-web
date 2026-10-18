import assert from 'node:assert/strict'
import test from 'node:test'
import { ConvexError } from 'convex/values'
import { describeFailure } from '@/server/observability/failure-classification'

process.env.NEXT_PUBLIC_CONVEX_URL = 'https://fixture.convex.cloud'

test('HTTP adapter carries application error data despite production message redaction', async t => {
  const { convex } = await import('./convex')
  for (const status of [200, 400]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      status: 'error', errorMessage: 'Server Error', errorData: 'NOTE_REVISION_CONFLICT',
    }), { status }))
    await assert.rejects(convex.mutation('files/files:update', {}, { throwOnError: true }),
      error => error instanceof ConvexError && error.data === 'NOTE_REVISION_CONFLICT')
    t.mock.restoreAll()
  }
})

test('structured Convex failures retain the backend request id without changing application error data', async t => {
  const { convex } = await import('./convex')
  for (const status of [200, 400]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      status: 'error', errorMessage: '[Request ID: abcdef123456] Uncaught Error: Unauthorized\nprivate@example.com',
      errorData: { code: 'AGENT_POLICY_LIMIT' },
    }), { status }))
    await assert.rejects(convex.query('agents/environmentControlPlane:getEnvironmentByServer', {}, { throwOnError: true }), error => {
      assert.ok(error instanceof ConvexError)
      assert.deepEqual(error.data, { code: 'AGENT_POLICY_LIMIT' })
      const diagnostic = describeFailure(error)
      assert.equal(diagnostic.convexRequestId, 'abcdef123456')
      assert.equal(diagnostic.failureSignature, 'CONVEX_AUTHORIZATION')
      assert.equal(diagnostic.httpStatus, status)
      assert.doesNotMatch(JSON.stringify(diagnostic), /private@example.com/)
      return true
    })
    t.mock.restoreAll()
  }
})

test('developer errors remain ordinary failures, and optional failures still return null', async t => {
  const { convex } = await import('./convex')
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    status: 'error', errorMessage: 'Server Error',
  })))
  await assert.rejects(convex.mutation('files/files:update', {}, { throwOnError: true }),
    error => error instanceof Error && !(error instanceof ConvexError) && error.message === 'Server Error')
  assert.equal(await convex.mutation('files/files:update', {}, { suppressNetworkConsoleError: true }), null)
})
