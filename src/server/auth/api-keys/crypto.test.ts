import 'server-only'

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  API_KEY_PREFIX,
  API_KEY_LENGTH,
  generateApiKey,
  hashApiKey,
  isApiKeyCandidate,
} from './crypto.ts'

test('generateApiKey emits prefixed opaque keys', () => {
  const key = generateApiKey()
  assert.equal(key.startsWith(API_KEY_PREFIX), true)
  assert.equal(key.length, API_KEY_LENGTH)
  assert.equal(isApiKeyCandidate(key), true)
})

test('hashApiKey is deterministic and rejects non-overlay keys', () => {
  const key = `${API_KEY_PREFIX}${'a'.repeat(43)}`
  assert.equal(hashApiKey(key), hashApiKey(key))
  assert.throws(() => hashApiKey('not-a-key'), /Invalid API key format/)
  assert.throws(() => hashApiKey(`${API_KEY_PREFIX}short`), /Invalid API key format/)
})
