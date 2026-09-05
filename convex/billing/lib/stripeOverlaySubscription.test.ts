import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mapSubscriptionStatus,
  resolveStripeEntitlementFields,
} from './stripeOverlaySubscription'

test('maps every unpaid or incomplete Stripe state to past due', () => {
  assert.equal(mapSubscriptionStatus('incomplete'), 'past_due')
  assert.equal(mapSubscriptionStatus('incomplete_expired'), 'past_due')
  assert.equal(mapSubscriptionStatus('unpaid'), 'past_due')
  assert.equal(mapSubscriptionStatus('paused'), 'past_due')
})

test('withholds paid access for a new incomplete subscription', () => {
  const result = resolveStripeEntitlementFields('past_due', {
    tier: 'pro',
    planKind: 'paid',
    planVersion: 'variable_v2',
    planAmountCents: 2_400,
    stripeQuantity: 24,
    autoTopUpEnabled: true,
  })

  assert.equal(result.planKind, 'free')
  assert.equal(result.planAmountCents, 0)
  assert.equal(result.autoTopUpEnabled, false)
})

test('preserves the confirmed allowance after a failed renewal or upgrade', () => {
  const result = resolveStripeEntitlementFields('past_due', {
    tier: 'max',
    planKind: 'paid',
    planVersion: 'variable_v2',
    planAmountCents: 9_600,
    stripeQuantity: 96,
  }, {
    tier: 'pro',
    planKind: 'paid',
    planVersion: 'variable_v2',
    planAmountCents: 2_400,
    stripeQuantity: 24,
    autoTopUpEnabled: true,
    autoTopUpAmountCents: 800,
  })

  assert.equal(result.planAmountCents, 2_400)
  assert.equal(result.stripeQuantity, 24)
  assert.equal(result.autoTopUpEnabled, true)
})

test('applies the target allowance only after Stripe reports active', () => {
  const result = resolveStripeEntitlementFields('active', {
    tier: 'max',
    planKind: 'paid',
    planVersion: 'variable_v2',
    planAmountCents: 9_600,
    stripeQuantity: 96,
  })

  assert.equal(result.planKind, 'paid')
  assert.equal(result.planAmountCents, 9_600)
  assert.equal(result.stripeQuantity, 96)
})
