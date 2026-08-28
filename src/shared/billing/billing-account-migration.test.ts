import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  BillingBalanceSnapshot,
  BillingSubscriptionVerificationRow,
  StripeSubscriptionVerificationRow,
} from './billing-account-migration'

const {
  compareBillingBalanceSnapshots,
  verifyStripeSubscriptionsExactly,
} = await import(new URL('./billing-account-migration.ts', import.meta.url).href)

test('balance parity names every divergent field', () => {
  const legacy: BillingBalanceSnapshot = {
    allowanceUsedMicros: 10,
    billingAccountId: 'ba_1',
    includedMicros: 100,
    institutionalGrantMicros: 0,
    mode: 'budgeted',
    reservedMicros: 5,
    topUpBalanceMicros: 20,
    topUpPurchasedMicros: 30,
    usedMicros: 20,
  }
  assert.equal(compareBillingBalanceSnapshots({ canonical: legacy, legacy, userId: 'user_1' }).matches, true)
  const report = compareBillingBalanceSnapshots({
    canonical: { ...legacy, reservedMicros: 6, usedMicros: 21 },
    legacy,
    userId: 'user_1',
  })
  assert.deepEqual(report.differences, ['reservedMicros', 'usedMicros'])
})

test('Stripe verification requires six exact account-linked matches', () => {
  const local: BillingSubscriptionVerificationRow[] = []
  const stripe: StripeSubscriptionVerificationRow[] = []
  local.push({ planAmountCents: 0, status: 'active', userId: 'free_user' })
  for (let index = 0; index < 6; index += 1) {
    local.push({
      billingAccountId: `ba_${index}`,
      planAmountCents: 800 + index * 100,
      providerCustomerId: `cus_${index}`,
      providerPriceId: 'price_paid_unit',
      providerQuantity: 8 + index,
      providerSubscriptionId: `sub_${index}`,
      status: 'active',
      userId: `user_${index}`,
    })
    stripe.push({
      planAmountCents: 800 + index * 100,
      providerCustomerId: `cus_${index}`,
      providerPriceId: 'price_paid_unit',
      providerQuantity: 8 + index,
      providerSubscriptionId: `sub_${index}`,
      status: 'active',
    })
  }
  assert.deepEqual(verifyStripeSubscriptionsExactly({
    expectedActiveSubscriptions: 6,
    local,
    stripe,
  }), {
    expectedActiveSubscriptions: 6,
    issues: [],
    localActiveSubscriptions: 6,
    matchedSubscriptions: 6,
    ok: true,
    stripeActiveSubscriptions: 6,
  })

  const mismatch = verifyStripeSubscriptionsExactly({
    expectedActiveSubscriptions: 6,
    local,
    stripe: stripe.map((row, index) => index === 0 ? { ...row, providerQuantity: 99 } : row),
  })
  assert.equal(mismatch.ok, false)
  assert.deepEqual(mismatch.issues, ['subscription_mismatch:sub_0:quantity'])
})
