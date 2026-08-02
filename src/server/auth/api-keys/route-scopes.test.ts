import test from 'node:test'
import assert from 'node:assert/strict'

const { getRequiredApiKeyScopesForRoute } = await import(
  new URL('./route-scopes.ts', import.meta.url).href
)

test('getRequiredApiKeyScopesForRoute maps conversation routes to chat scopes', () => {
  assert.deepEqual(getRequiredApiKeyScopesForRoute('GET', '/api/v1/conversations'), ['chat:read'])
  assert.deepEqual(getRequiredApiKeyScopesForRoute('POST', '/api/v1/conversations/act'), ['chat:write'])
})

test('getRequiredApiKeyScopesForRoute maps file and note routes to file scopes', () => {
  assert.deepEqual(getRequiredApiKeyScopesForRoute('GET', '/api/v1/files/file_123/content'), ['files:read'])
  assert.deepEqual(getRequiredApiKeyScopesForRoute('GET', '/api/v1/files/presign'), ['files:write'])
  assert.deepEqual(getRequiredApiKeyScopesForRoute('PATCH', '/api/v1/notes'), ['files:write'])
  assert.deepEqual(getRequiredApiKeyScopesForRoute('POST', '/api/v1/files/search-text'), ['files:read'])
})

test('getRequiredApiKeyScopesForRoute defaults unclassified routes to admin', () => {
  assert.deepEqual(getRequiredApiKeyScopesForRoute('GET', '/api/v1/subscription'), ['admin'])
})
