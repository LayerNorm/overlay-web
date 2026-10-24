import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sanitizeOpenCodeGoProbeError,
  selectOpenCodeGoProbeModel,
} from './opencode-go-probe'

test('OpenCode Go probe prefers a free chat model', () => {
  assert.deepEqual(
    selectOpenCodeGoProbeModel([
      { id: 'grok-4.7' },
      { id: 'glm-5.3-flash-free' },
      { id: 'claude-haiku-5-5' },
      { id: 'glm-5.3-flash' },
    ]),
    { id: 'glm-5.3-flash-free' },
  )
})

test('OpenCode Go probe falls back to the first chat model', () => {
  assert.deepEqual(
    selectOpenCodeGoProbeModel([
      { id: 'grok-4.7' },
      { id: 'claude-haiku-5-5' },
      { id: 'glm-5.3-flash' },
    ]),
    { id: 'glm-5.3-flash' },
  )
  assert.equal(selectOpenCodeGoProbeModel([{ id: 'grok-4.7' }]), null)
})

test('OpenCode Go probe failures expose safe categories without secrets', () => {
  const key = 'test-secret'
  assert.match(
    sanitizeOpenCodeGoProbeError(
      Object.assign(new Error('MissingSessionID test-secret'), { statusCode: 400 }),
      key,
    ),
    /MissingSessionID/,
  )
  assert.match(
    sanitizeOpenCodeGoProbeError(
      Object.assign(new Error('invalid api key test-secret'), { statusCode: 401 }),
      key,
    ),
    /rejected the API key/,
  )
  assert.match(
    sanitizeOpenCodeGoProbeError(
      Object.assign(new Error('subscription required test-secret'), { statusCode: 402 }),
      key,
    ),
    /subscription or billing/,
  )
  assert.doesNotMatch(
    sanitizeOpenCodeGoProbeError(new Error('test-secret'), key),
    /test-secret/,
  )
})
