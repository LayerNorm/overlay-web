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

test('structured Harness diagnostics survive native error parsing', () => {
  const diagnostic = {
    diagnosticId: 'hd_parser_roundtrip',
    code: 'MODEL_OUTCOME_UNKNOWN',
    stage: 'model',
    retryability: 'reconcile',
    safeMessage: 'A model request ended without confirmed usage.',
    nextAction: 'Reconcile the outstanding request before retrying it.',
    occurredAt: 2,
  } as const
  const error = { ...failure, retryable: false, diagnostic }
  assert.deepEqual(readNativeAgentError([{ type: NATIVE_AGENT_ERROR_PART, data: error }]), error)
})

test('projected explanations redact credentials and URLs without reclassifying the cause', () => {
  const cause = 'Provider request failed: https://provider.test?token=private Bearer opaque-token api_key=private-key token=private-token client_secret=private-secret sk-examplecredential12345'
  const message = nativeAgentErrorMessage(cause)
  assert.ok(message.startsWith('Provider request failed:'))
  for (const secret of ['private', 'opaque-token', 'private-token', 'private-secret', 'examplecredential']) assert.ok(!message.includes(secret))
  assert.equal(nativeAgentErrorMessage('x'.repeat(3_000)).length, 2_000)
  assert.equal(nativeAgentErrorMessage('No durable progress.'), 'No durable progress.')
})
