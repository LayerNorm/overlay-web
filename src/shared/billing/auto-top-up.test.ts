import test from 'node:test'
import assert from 'node:assert/strict'

import { decideAutoTopUp, validateAutoTopUpInput, type AutoTopUpSettings } from './auto-top-up'

const ready: AutoTopUpSettings = {
  enabled: true,
  amountCents: 800,
  monthlyLimitCents: 2_400,
  spentThisPeriodCents: 0,
  offSessionConsentAt: 1,
  stripeCustomerId: 'cus_1',
}

test('hard stop is the default: nothing is charged unless top-ups are on', () => {
  assert.deepEqual(decideAutoTopUp({ ...ready, enabled: false }), { charge: false, reason: 'disabled' })
})

test('tops up when on, consented, with a customer, and under the limit', () => {
  assert.deepEqual(decideAutoTopUp(ready), { charge: true, amountCents: 800 })
})

test('stops at the monthly limit', () => {
  assert.deepEqual(decideAutoTopUp({ ...ready, spentThisPeriodCents: 1_600 }), { charge: true, amountCents: 800 })
  assert.deepEqual(decideAutoTopUp({ ...ready, spentThisPeriodCents: 2_400 }), { charge: false, reason: 'monthly_limit_reached' })
  assert.deepEqual(decideAutoTopUp({ ...ready, spentThisPeriodCents: 2_000 }), { charge: false, reason: 'monthly_limit_reached' })
})

test('no limit set means no automatic top-ups', () => {
  assert.deepEqual(decideAutoTopUp({ ...ready, monthlyLimitCents: undefined }), { charge: false, reason: 'monthly_limit_reached' })
})

test('needs consent and a Stripe customer', () => {
  assert.equal(decideAutoTopUp({ ...ready, offSessionConsentAt: undefined }).charge, false)
  assert.equal(decideAutoTopUp({ ...ready, stripeCustomerId: undefined }).charge, false)
})

test('a top-up smaller than what is needed does not run', () => {
  assert.deepEqual(decideAutoTopUp(ready, 900), { charge: false, reason: 'amount_too_small' })
})

test('owner input: limit must cover one top-up; amount $8 to $500', () => {
  assert.equal(validateAutoTopUpInput({ enabled: true, amountCents: 800, monthlyLimitCents: 800 }).ok, true)
  assert.equal(validateAutoTopUpInput({ enabled: true, amountCents: 800, monthlyLimitCents: 700 }).ok, false)
  assert.equal(validateAutoTopUpInput({ enabled: true, amountCents: 700, monthlyLimitCents: 2_000 }).ok, false)
  assert.equal(validateAutoTopUpInput({ enabled: true, amountCents: 50_100, monthlyLimitCents: 60_000 }).ok, false)
  assert.equal(validateAutoTopUpInput({ enabled: false, amountCents: 0, monthlyLimitCents: 0 }).ok, true)
})
