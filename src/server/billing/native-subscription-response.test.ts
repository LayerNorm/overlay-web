import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNativeSubscriptionResponse } from './native-subscription-response'

test('native subscription response preserves existing fields and adds state compatibly', () => {
  const response = buildNativeSubscriptionResponse({
    tier: 'pro',
    planKind: 'paid',
    planAmountCents: 2_400,
    status: 'active',
    stripeQuantity: 24,
    cancelAtPeriodEnd: true,
    budgetUsedCents: 500,
    budgetTotalCents: 2_400,
    budgetRemainingCents: 1_900,
    autoTopUpEnabled: false,
    autoTopUpAmountCents: 800,
    autoTopUpConsentGranted: false,
    creditsUsed: 5,
    creditsTotal: 24,
    dailyUsage: { ask: 1, write: 2, agent: 3 },
  })

  assert.equal(response.tier, 'pro')
  assert.equal(response.planKind, 'paid')
  assert.equal(response.creditsUsed, 500)
  assert.equal(response.creditsTotal, 24)
  assert.equal(response.planId, 'pro')
  assert.equal(response.planDisplayName, 'Pro')
  assert.equal(response.status, 'active')
  assert.equal(response.cancelAtPeriodEnd, true)
})
