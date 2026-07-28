import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getOwnerFundedOperation,
  ownerFundedOperationRequiresIdempotencyKey,
  OWNER_FUNDED_OPERATIONS,
} from './owner-funded-operations'

test('owner-funded operation registry is exact and has unique routes and ids', () => {
  const routeKeys = OWNER_FUNDED_OPERATIONS.map(
    ({ method, path }) => `${method} ${path}`,
  )
  const ids = OWNER_FUNDED_OPERATIONS.map(({ id }) => id)

  assert.equal(new Set(routeKeys).size, routeKeys.length)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(
    getOwnerFundedOperation('POST', '/api/v1/generate-image')?.id,
    'media.generate-image',
  )
  assert.equal(
    getOwnerFundedOperation('GET', '/api/v1/generate-image'),
    null,
  )
  assert.equal(
    getOwnerFundedOperation('POST', '/api/v1/generate-image/other'),
    null,
  )
})

test('idempotency keys are required for owner-funded mutations but not reads', () => {
  assert.equal(
    ownerFundedOperationRequiresIdempotencyKey(
      getOwnerFundedOperation('POST', '/api/v1/conversations/act'),
    ),
    true,
  )
  assert.equal(
    ownerFundedOperationRequiresIdempotencyKey(
      getOwnerFundedOperation('GET', '/api/v1/chat-suggestions'),
    ),
    false,
  )
})
