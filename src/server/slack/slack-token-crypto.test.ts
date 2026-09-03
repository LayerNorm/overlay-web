import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptPlatformToken, encryptPlatformToken, isValidPlatformTokenKey } from './slack-token-crypto'

const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64')
const OTHER_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => 32 - i)).toString('base64')

test('platform token encryption round-trips', () => {
  const cipher = encryptPlatformToken({ plaintext: 'xoxb-secret-token', keyBase64: KEY })
  assert.notEqual(cipher, 'xoxb-secret-token')
  assert.equal(decryptPlatformToken({ cipher, keyBase64: KEY }), 'xoxb-secret-token')
})

test('platform token ciphertext is randomized per encryption', () => {
  const first = encryptPlatformToken({ plaintext: 'xoxb-same', keyBase64: KEY })
  const second = encryptPlatformToken({ plaintext: 'xoxb-same', keyBase64: KEY })
  assert.notEqual(first, second)
  assert.equal(decryptPlatformToken({ cipher: second, keyBase64: KEY }), 'xoxb-same')
})

test('platform token decryption fails closed on tampering and wrong keys', () => {
  const cipher = encryptPlatformToken({ plaintext: 'xoxb-secret', keyBase64: KEY })
  assert.throws(() => decryptPlatformToken({ cipher, keyBase64: OTHER_KEY }))
  assert.throws(() => decryptPlatformToken({ cipher: `${cipher}tampered`, keyBase64: KEY }))
  assert.throws(() => decryptPlatformToken({ cipher: 'garbage', keyBase64: KEY }))
})

test('platform token key validation rejects weak keys', () => {
  assert.equal(isValidPlatformTokenKey(KEY), true)
  assert.equal(isValidPlatformTokenKey(undefined), false)
  assert.equal(isValidPlatformTokenKey(''), false)
  assert.equal(isValidPlatformTokenKey('too-short'), false)
  assert.equal(isValidPlatformTokenKey(Buffer.alloc(32).toString('base64')), false)
})
