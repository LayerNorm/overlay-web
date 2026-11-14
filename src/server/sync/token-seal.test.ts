import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openSyncToken, sealSyncToken } from './token-seal'

process.env.SLACK_ENCRYPTION_KEY = 'a'.repeat(64)

test('sealed tokens round-trip and do not contain the token', () => {
  const sealed = sealSyncToken('xoxp-secret-token')
  assert.equal(sealed.includes('xoxp'), false)
  assert.equal(openSyncToken(sealed), 'xoxp-secret-token')
  assert.notEqual(sealSyncToken('xoxp-secret-token'), sealed)
})

test('tampered tokens are rejected', () => {
  const sealed = sealSyncToken('token')
  const parts = sealed.split('.')
  parts[3] = Buffer.from('other').toString('base64url')
  assert.throws(() => openSyncToken(parts.join('.')))
})
