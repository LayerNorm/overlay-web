import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocateUsageCharge,
  availableUsageBalance,
  deriveUsageBuckets,
  legacyUsageTotal,
  refundUsageAllocation,
  topUpBalanceAfterReservations,
} from './usage-buckets'

test('usage allocation conserves allowance and top-up value without creation or loss', () => {
  const initial = deriveUsageBuckets({ allowanceTotal: 1_000, legacyUsed: 0, topUpPurchased: 500 })
  const charged = allocateUsageCharge(initial, 1_200)
  assert.deepEqual(charged.allocation, { allowance: 1_000, topUp: 200 })
  assert.equal(charged.buckets.topUpBalance, 300)
  assert.equal(legacyUsageTotal(charged.buckets), 1_200)
  assert.equal(availableUsageBalance(charged.buckets), 300)

  const refunded = refundUsageAllocation(charged.buckets, charged.allocation, 350)
  assert.deepEqual(refunded.allocation, { allowance: 150, topUp: 200 })
  assert.equal(refunded.buckets.allowanceUsed, 850)
  assert.equal(refunded.buckets.topUpBalance, 500)
  assert.equal(legacyUsageTotal(refunded.buckets), 850)
  assert.equal(availableUsageBalance(refunded.buckets), 650)
})

test('replayed charges are prevented by caller idempotency and bucket allocation rejects double-spend', () => {
  const initial = deriveUsageBuckets({ allowanceTotal: 100, legacyUsed: 0, topUpPurchased: 50 })
  const charged = allocateUsageCharge(initial, 150).buckets
  assert.equal(availableUsageBalance(charged), 0)
  assert.throws(() => allocateUsageCharge(charged, 1), /insufficient_budget/)
})

test('reserved work reduces displayed top-up balance only after allowance capacity is reserved', () => {
  const buckets = deriveUsageBuckets({ allowanceTotal: 100, legacyUsed: 75, topUpPurchased: 50 })
  assert.equal(topUpBalanceAfterReservations(buckets, 20), 50)
  assert.equal(topUpBalanceAfterReservations(buckets, 40), 35)
})

test('reservation reconciliation restores only the unused allocation and conserves every credit', () => {
  const initial = deriveUsageBuckets({ allowanceTotal: 1_000, legacyUsed: 0, topUpPurchased: 500 })
  const reserved = allocateUsageCharge(initial, 1_400)
  const finalized = refundUsageAllocation(reserved.buckets, reserved.allocation, 300).buckets

  assert.equal(finalized.allowanceUsed, 1_000)
  assert.equal(finalized.topUpBalance, 400)
  assert.equal(legacyUsageTotal(finalized), 1_100)
  assert.equal(availableUsageBalance(finalized), 400)
  assert.equal(legacyUsageTotal(finalized) + availableUsageBalance(finalized), 1_500)

  const second = allocateUsageCharge(finalized, 400)
  assert.equal(legacyUsageTotal(second.buckets), 1_500)
  assert.equal(availableUsageBalance(second.buckets), 0)
  assert.throws(() => allocateUsageCharge(second.buckets, 0.01), /insufficient_budget/)
})
