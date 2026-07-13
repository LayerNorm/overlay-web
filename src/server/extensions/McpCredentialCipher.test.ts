import assert from 'node:assert/strict'
import test from 'node:test'
import { McpCredentialCipher } from './McpCredentialCipher'

test('MCP credentials are authenticated, encrypted, and support bounded key rotation', () => {
  const oldKey = 'old-mcp-encryption-key-that-is-at-least-thirty-two-characters'
  const newKey = 'new-mcp-encryption-key-that-is-at-least-thirty-two-characters'
  const payload = new McpCredentialCipher([oldKey]).encrypt({ bearerToken: 'secret-token' })
  assert.ok(payload)
  assert.equal(payload?.includes('secret-token'), false)
  assert.deepEqual(new McpCredentialCipher([newKey, oldKey]).decrypt(payload), {
    bearerToken: 'secret-token',
  })
  assert.throws(() => new McpCredentialCipher([newKey]).decrypt(payload))
  assert.throws(() => new McpCredentialCipher([]).encrypt({ bearerToken: 'secret-token' }))
})
