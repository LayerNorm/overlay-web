import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasRequiredApiKeyScopes,
  isApiKeyScope,
  normalizeApiKeyScopes,
} from './api-key-scopes.ts'

test('normalizeApiKeyScopes de-dupes valid scopes', () => {
  assert.deepEqual(
    normalizeApiKeyScopes(['chat:read', 'chat:read', 'files:write']),
    ['chat:read', 'files:write'],
  )
})

test('normalizeApiKeyScopes rejects unknown scopes', () => {
  assert.equal(isApiKeyScope('admin'), true)
  assert.equal(isApiKeyScope('billing:write'), false)
  assert.throws(() => normalizeApiKeyScopes(['billing:write']), /Invalid API key scope/)
})

test('hasRequiredApiKeyScopes requires every requested scope unless admin is granted', () => {
  assert.equal(hasRequiredApiKeyScopes(['chat:read'], ['chat:read']), true)
  assert.equal(hasRequiredApiKeyScopes(['chat:read'], ['chat:write']), false)
  assert.equal(hasRequiredApiKeyScopes(['admin'], ['files:write']), true)
})
