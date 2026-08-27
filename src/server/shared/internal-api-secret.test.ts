import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesInternalApiSecret } from './internal-api-secret'

const SECRET = 'a'.repeat(64)

test('matchesInternalApiSecret accepts the exact secret', () => {
  assert.equal(matchesInternalApiSecret(SECRET, SECRET), true)
})

test('matchesInternalApiSecret rejects a wrong secret of equal length', () => {
  assert.equal(matchesInternalApiSecret('b'.repeat(64), SECRET), false)
})

test('matchesInternalApiSecret rejects empty and missing input', () => {
  assert.equal(matchesInternalApiSecret('', SECRET), false)
  assert.equal(matchesInternalApiSecret(null, SECRET), false)
  assert.equal(matchesInternalApiSecret(undefined, SECRET), false)
})

test('matchesInternalApiSecret rejects multibyte input without throwing', () => {
  // 64 characters but 128 bytes: comparing string length would reach
  // timingSafeEqual with mismatched buffers and throw a RangeError.
  assert.equal(matchesInternalApiSecret('é'.repeat(64), SECRET), false)
})
