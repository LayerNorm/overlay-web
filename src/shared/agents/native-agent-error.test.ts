import assert from 'node:assert/strict'
import test from 'node:test'
import { NATIVE_AGENT_ERROR_PART, nativeAgentErrorMessage, readNativeAgentError } from './native-agent-error'

const failure = { runId: 'run-1', code: 'harness_failed', message: 'No durable progress.', retryable: false, failedAt: 1 }

test('structured failures survive reload without deriving causes from assistant text', () => {
  const parts = [{ type: 'text', text: 'I lost my network connection.' }, { type: NATIVE_AGENT_ERROR_PART, data: failure }]
  assert.deepEqual(readNativeAgentError(JSON.parse(JSON.stringify(parts))), failure)
  assert.equal(readNativeAgentError(parts.slice(0, 1)), undefined)
  for (const patch of [{ runId: '' }, { code: '' }, { message: '' }, { retryable: 'true' }, { failedAt: NaN }]) {
    assert.equal(readNativeAgentError([{ type: NATIVE_AGENT_ERROR_PART, data: { ...failure, ...patch } }]), undefined)
  }
})

test('projected explanations redact credentials and URLs without reclassifying the cause', () => {
  const cause = 'Provider request failed: https://provider.test?token=private Bearer opaque-token api_key=private-key token=private-token client_secret=private-secret sk-examplecredential12345'
  const message = nativeAgentErrorMessage(cause)
  assert.ok(message.startsWith('Provider request failed:'))
  for (const secret of ['private', 'opaque-token', 'private-token', 'private-secret', 'examplecredential']) assert.ok(!message.includes(secret))
  assert.equal(nativeAgentErrorMessage('x'.repeat(3_000)).length, 2_000)
  assert.equal(nativeAgentErrorMessage('No durable progress.'), 'No durable progress.')
})
