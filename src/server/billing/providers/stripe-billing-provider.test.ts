import assert from 'node:assert/strict'
import test from 'node:test'
import { stripe } from '../stripe'
import type { BillingRepository } from '../BillingRepository'
import { StripeBillingProvider } from './stripe-billing-provider'

test('workspace customer synchronization sends only accepted subscription fields and fails closed', async t => {
  const previousKey = process.env.DEV_STRIPE_SECRET_KEY
  const previousEnv = process.env.VERCEL_ENV
  process.env.DEV_STRIPE_SECRET_KEY = 'sk_test_fixture'
  process.env.VERCEL_ENV = 'preview'
  t.after(() => {
    if (previousKey === undefined) delete process.env.DEV_STRIPE_SECRET_KEY
    else process.env.DEV_STRIPE_SECRET_KEY = previousKey
    if (previousEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = previousEnv
  })
  t.mock.method(stripe.customers, 'create', async () => ({ id: 'cus_workspace' }))
  const checkout = t.mock.method(stripe.checkout.sessions, 'create', async () => ({
    id: 'cs_workspace', url: 'https://stripe.test/checkout',
  }))
  let failSync = false
  const provider = new StripeBillingProvider({
    paidUnitPriceId: 'price_paid', baseUrl: 'https://preview.test',
    repository: {
      async getBillingAccountSubscriptionByServer() {
        return { planKind: 'paid', planAmountCents: 500, status: 'active', tier: 'pro' }
      },
      async upsertBillingAccountSubscription(args) {
        assert.deepEqual(args, {
          billingAccountId: 'ba_workspace', stripeCustomerId: 'cus_workspace', stripeSubscriptionId: undefined,
          planKind: 'paid', planAmountCents: 500, status: 'active',
        })
        if (failSync) throw new Error('customer sync failed')
        return { applied: true }
      },
    } as BillingRepository,
  })
  const args = {
    userId: 'user_1', billingAccountId: 'ba_workspace', workspaceId: 'workspace_1', email: 'fixture@example.test',
    kind: 'paid_plan' as const, planAmountCents: 800, topUpAmountCents: 800,
  }
  await provider.createCheckoutSession(args)
  assert.equal(checkout.mock.callCount(), 1)
  failSync = true
  await assert.rejects(provider.createCheckoutSession(args), /customer sync failed/)
  assert.equal(checkout.mock.callCount(), 1)
})
