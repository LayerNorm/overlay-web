import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

test('session encryption uses the current key and reads the previous key during rotation', async () => {
  const original = snapshotEnv([
    'SESSION_COOKIE_ENCRYPTION_KEY',
    'SESSION_COOKIE_ENCRYPTION_KEY_PREVIOUS',
    'SESSION_TRANSFER_KEY',
    'SESSION_TRANSFER_KEY_PREVIOUS',
  ])
  try {
    process.env.SESSION_COOKIE_ENCRYPTION_KEY = 'old-cookie-encryption-key-0123456789abcdef'
    process.env.SESSION_TRANSFER_KEY = 'old-transfer-encryption-key-0123456789abcdef'
    const cryptoModule = await import('./session-transfer-crypto')
    const oldCookie = cryptoModule.encryptSessionCookiePayload('old-cookie')
    const oldTransfer = cryptoModule.encryptSessionTransferPayload('old-transfer')

    process.env.SESSION_COOKIE_ENCRYPTION_KEY_PREVIOUS = process.env.SESSION_COOKIE_ENCRYPTION_KEY
    process.env.SESSION_TRANSFER_KEY_PREVIOUS = process.env.SESSION_TRANSFER_KEY
    process.env.SESSION_COOKIE_ENCRYPTION_KEY = 'new-cookie-encryption-key-0123456789abcdef'
    process.env.SESSION_TRANSFER_KEY = 'new-transfer-encryption-key-0123456789abcdef'

    assert.equal(cryptoModule.decryptSessionCookiePayload(oldCookie), 'old-cookie')
    assert.equal(cryptoModule.decryptSessionTransferPayload(oldTransfer), 'old-transfer')
    assert.equal(
      cryptoModule.decryptSessionCookiePayload(cryptoModule.encryptSessionCookiePayload('new-cookie')),
      'new-cookie',
    )
  } finally {
    restoreEnv(original)
  }
})

function snapshotEnv(keys: readonly string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(snapshot: ReadonlyMap<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
