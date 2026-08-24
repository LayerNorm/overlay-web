import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChatTransportHttpError,
  createChatDiagnosticFetch,
} from './direct-chat-transport'

test('preserves structured upstream error details for browser diagnostics', async () => {
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const diagnosticFetch = createChatDiagnosticFetch(async () => new Response(JSON.stringify({
      code: 'provider_upstream_failed',
      error: 'Provider rejected the request',
      fallbackSafe: false,
      phase: 'upstream',
      requestId: 'request-456',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }))

    await assert.rejects(
      diagnosticFetch('/api/v1/conversations/act', {
        headers: { 'x-request-id': 'request-456' },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ChatTransportHttpError)
        assert.equal(error.status, 502)
        assert.equal(error.phase, 'upstream')
        assert.equal(error.fallbackSafe, false)
        assert.equal(error.requestId, 'request-456')
        assert.equal(error.message, 'Provider rejected the request')
        return true
      },
    )
  } finally {
    console.error = originalConsoleError
  }
})
