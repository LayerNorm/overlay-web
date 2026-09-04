import test from 'node:test'
import assert from 'node:assert/strict'

const {
  PAID_PLAN_MAX_AMOUNT_CENTS,
  PAID_PLAN_MIN_AMOUNT_CENTS,
  PAID_STORAGE_BASE_BYTES,
  applyMarkupToDollars,
  clampPaidPlanAmountCents,
  getStorageLimitBytes,
  getPersonalPlanById,
  getPersonalPlanFromAmountCents,
  getPersonalPlanFromQuantity,
  getPersonalPlanPresentation,
  isValidTopUpAmount,
  planAmountCentsToQuantity,
  quantityToPlanAmountCents,
} = await import(new URL('./billing-pricing.ts', import.meta.url).href)
test('clampPaidPlanAmountCents enforces slider bounds and steps', () => {
  assert.equal(clampPaidPlanAmountCents(755), PAID_PLAN_MIN_AMOUNT_CENTS)
  assert.equal(clampPaidPlanAmountCents(1_649), 1_600)
  assert.equal(clampPaidPlanAmountCents(99_999), PAID_PLAN_MAX_AMOUNT_CENTS)
})

test('quantity conversion tracks one dollar per quantity', () => {
  assert.equal(quantityToPlanAmountCents(8), 800)
  assert.equal(quantityToPlanAmountCents(20), 2_000)
  assert.equal(planAmountCentsToQuantity(12_300), 123)
})

test('personal plans map trusted ids, quantities, and amounts to the same catalog entries', () => {
  assert.equal(getPersonalPlanById('starter')?.stripeQuantity, 8)
  assert.equal(getPersonalPlanById('pro')?.amountCents, 2_400)
  assert.equal(getPersonalPlanById('max')?.storageBytes, PAID_STORAGE_BASE_BYTES * 12)
  assert.equal(getPersonalPlanFromQuantity(24)?.id, 'pro')
  assert.equal(getPersonalPlanFromAmountCents(9_600)?.id, 'max')
  assert.equal(getPersonalPlanById('enterprise'), null)
  assert.equal(getPersonalPlanFromQuantity(24.4), null)
  assert.equal(getPersonalPlanFromAmountCents('2400'), null)
})

test('personal plan presentation preserves non-catalog paid amounts as legacy', () => {
  assert.deepEqual(
    getPersonalPlanPresentation({ planKind: 'paid', planAmountCents: 800, stripeQuantity: 8 }),
    { planId: 'starter', planDisplayName: 'Starter', isLegacyPlan: false },
  )
  assert.deepEqual(
    getPersonalPlanPresentation({ planKind: 'paid', planAmountCents: 1_500, stripeQuantity: 15 }),
    { planId: null, planDisplayName: 'Legacy $15', isLegacyPlan: true },
  )
  assert.deepEqual(
    getPersonalPlanPresentation({ planKind: 'free', planAmountCents: 0 }),
    { planId: 'free', planDisplayName: 'Free', isLegacyPlan: false },
  )
})

test('paid storage scales linearly with spend', () => {
  assert.equal(getStorageLimitBytes({ planKind: 'paid', planAmountCents: 800 }), PAID_STORAGE_BASE_BYTES)
  assert.equal(getStorageLimitBytes({ planKind: 'paid', planAmountCents: 1_600 }), PAID_STORAGE_BASE_BYTES * 2)
})

test('markup applies to provider spend', () => {
  assert.equal(applyMarkupToDollars({ providerCostUsd: 8 }), 1_000)
  assert.equal(applyMarkupToDollars({ providerCostUsd: 0.2 }), 25)
})

test('top-up amount validation rejects unsupported raw amounts', () => {
  assert.equal(isValidTopUpAmount(800), true)
  assert.equal(isValidTopUpAmount(850), false)
  assert.equal(isValidTopUpAmount(20_050), false)
})
