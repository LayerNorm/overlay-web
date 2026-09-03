import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

/**
 * AES-256-GCM envelope for chat-platform bot tokens. Tokens are encrypted in
 * the server layer before storage and decrypted only when resolving an
 * installation for an outbound call — repositories and Convex/Postgres rows
 * only ever see the ciphertext envelope (`v1.<iv>.<ciphertext>.<tag>`,
 * base64url parts).
 */
export function encryptPlatformToken(args: {
  plaintext: string
  keyBase64: string
}): string {
  const key = decodeKey(args.keyBase64)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(args.plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.')
}

export function decryptPlatformToken(args: {
  cipher: string
  keyBase64: string
}): string {
  const key = decodeKey(args.keyBase64)
  const parts = args.cipher.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1' || !parts[1] || !parts[2] || !parts[3]) {
    throw new Error('PLATFORM_TOKEN_CIPHER_INVALID')
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[1], 'base64url'))
  decipher.setAuthTag(Buffer.from(parts[3], 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parts[2], 'base64url')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}

/** Constant-time check that a ciphertext envelope was produced by this key. */
export function platformTokenMatchesKey(args: { cipher: string; keyBase64: string }): boolean {
  try {
    decryptPlatformToken(args)
    return true
  } catch (_error) {
    void _error
    return false
  }
}

export function isValidPlatformTokenKey(value: string | undefined): boolean {
  if (!value) return false
  try {
    decodeKey(value)
    return true
  } catch (_error) {
    void _error
    return false
  }
}

function decodeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64.trim(), 'base64')
  if (key.length !== KEY_BYTES) throw new Error('PLATFORM_TOKEN_KEY_INVALID')
  // Reject all-zero keys that usually indicate a placeholder secret.
  if (timingSafeEqual(key, Buffer.alloc(KEY_BYTES))) throw new Error('PLATFORM_TOKEN_KEY_INVALID')
  return key
}
