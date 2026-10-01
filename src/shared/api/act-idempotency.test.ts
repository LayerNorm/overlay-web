import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildActStreamIdempotencyKey,
  buildActStreamIdempotencyKeyFromMetadata,
  parseActStreamIdempotencyKey,
} from './act-idempotency.ts'

test('buildActStreamIdempotencyKey encodes turn and slot', () => {
  assert.equal(buildActStreamIdempotencyKey('turn-abc', 2), 'act:turn-abc:2')
  assert.equal(buildActStreamIdempotencyKeyFromMetadata('turn-abc', 2), 'act:turn-abc:2')
})

test('parseActStreamIdempotencyKey round-trips valid keys', () => {
  const parsed = parseActStreamIdempotencyKey('act:turn-abc:2')
  assert.deepEqual(parsed, { turnId: 'turn-abc', slotIndex: 2 })
  assert.equal(parseActStreamIdempotencyKey('not-a-key'), null)
})

test('buildActStreamIdempotencyKey rejects empty turnId', () => {
  assert.throws(() => buildActStreamIdempotencyKey('  '), /turnId is required/)
})
