import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  errorLabel,
  looksLikeStoredGenerationError,
  persistedGenerationErrorMessage,
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

test('persistedGenerationErrorMessage keeps real stored error strings', () => {
  assert.equal(persistedGenerationErrorMessage('Generation failed.'), 'Generation failed.')
  assert.equal(
    persistedGenerationErrorMessage('generation_interrupted_server_timeout'),
    'generation_interrupted_server_timeout',
  )
})
