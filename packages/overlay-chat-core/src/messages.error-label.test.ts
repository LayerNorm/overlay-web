import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  errorLabel,
  isUsageExhaustedError,
  looksLikeStoredGenerationError,
  persistedGenerationErrorMessage,
  USAGE_EXHAUSTED_LABEL,
} from './messages'

test('errorLabel maps network failures to a connection-lost message', () => {
  assert.equal(
    errorLabel(new Error('Failed to fetch')),
    'Connection lost mid-response. Check your network and try again.',
  )
  assert.equal(
    errorLabel(new Error('WebSocket connection to wss://example.convex.cloud failed')),
    'Connection lost mid-response. Check your network and try again.',
  )
})

test('persistedGenerationErrorMessage does not treat assistant prose as the error', () => {
  const prose =
    'Love this instinct — the landing page is your highest-leverage retention/distribution asset right now.'
  assert.equal(looksLikeStoredGenerationError(prose), false)
  assert.equal(persistedGenerationErrorMessage(prose), 'generation_interrupted_connection')
  assert.equal(
    errorLabel(new Error(persistedGenerationErrorMessage(prose))),
    'Connection lost mid-response. Check your network and try again.',
  )
})

test('errorLabel maps exhausted usage to the account top-up message', () => {
  assert.equal(errorLabel(new Error('insufficient_credits')), USAGE_EXHAUSTED_LABEL)
  assert.equal(errorLabel(new Error('insufficient_budget')), USAGE_EXHAUSTED_LABEL)
  assert.equal(errorLabel(new Error('No budget remaining. Switch to a free model or top up your account.')), USAGE_EXHAUSTED_LABEL)
  assert.equal(errorLabel(new Error("No such subscription: 'sub_1TKxeqPH7ssnO0LIvQigJkN7'")), USAGE_EXHAUSTED_LABEL)
  assert.equal(isUsageExhaustedError(USAGE_EXHAUSTED_LABEL), true)
  assert.equal(looksLikeStoredGenerationError("No such subscription: 'sub_1TKxeqPH7ssnO0LIvQigJkN7'"), true)
})

test('persistedGenerationErrorMessage keeps real stored error strings', () => {
  assert.equal(persistedGenerationErrorMessage('Generation failed.'), 'Generation failed.')
  assert.equal(
    persistedGenerationErrorMessage('generation_interrupted_server_timeout'),
    'generation_interrupted_server_timeout',
  )
})

test('provider error labels preserve ordered terms and line boundaries for long untrusted input', () => {
  const fallback = 'Something went wrong. Please try again.'
  const unavailable = 'That model is not available from the provider right now. Try another model.'
  for (const text of ['gateway auth unavailable', 'provider billing disabled', 'GATEWAY key refused', 'provider quota exhausted'])
    assert.equal(errorLabel(new Error(text)), text)
  for (const separator of ['\n', '\r', '\u2028', '\u2029']) {
    assert.equal(errorLabel(new Error('gateway' + separator + 'quota')), fallback)
    assert.equal(errorLabel(new Error('model' + separator + 'not found')), fallback)
  }
  for (const text of ['Model unavailable: not found', 'not found: model', 'MODEL_NOT_FOUND']) assert.equal(errorLabel(new Error(text)), unavailable)
  for (const prefix of ['gateway', 'provider', 'model', 'not found']) assert.equal(errorLabel(new Error(prefix.repeat(20000))), fallback)
})
