import assert from 'node:assert/strict'
import test from 'node:test'
import { hashOperationalIdentifier } from './operational-key-hash'

test('operational identifier hashes are deterministic and domain separated', () => {
  const value = 'sensitive-runtime-identifier'
  const first = hashOperationalIdentifier('rate-limit:v1', value)

  assert.equal(first, hashOperationalIdentifier('rate-limit:v1', value))
  assert.notEqual(first, hashOperationalIdentifier('idempotency:v1', value))
  assert.equal(first.includes(value), false)
})
