import assert from 'node:assert/strict'
import test from 'node:test'
import Stripe from 'stripe'
import { StripeBillingProvider } from './stripe-billing-provider'

function subscriptionFixture(quantity: number): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    metadata: {},
    discounts: [],
    default_tax_rates: [],
    automatic_tax: { enabled: false },
    collection_method: 'charge_automatically',
    cancel_at: null,
    cancel_at_period_end: false,
    schedule: null,
    items: {
      data: [{
        id: 'si_1',
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
        discounts: [],
        metadata: {},
        price: { id: 'price_unit', currency: 'usd' },
        quantity,
        tax_rates: [],
      }],
    },
  } as unknown as Stripe.Subscription
}

test('StripeBillingProvider invoices upgrades now with pending-update payment protection', async () => {
  const updates: Array<{ params: Stripe.SubscriptionUpdateParams; options?: Stripe.RequestOptions }> = []
  const subscription = subscriptionFixture(8)
  const stripeClient = {
    checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://stripe.test' }) } },
    billingPortal: {
      configurations: { retrieve: async () => ({ features: { subscription_update: { enabled: false } } }) },
      sessions: { create: async () => ({ id: 'bps_1', url: 'https://stripe.test/portal' }) },
    },
    customers: { retrieve: async () => ({ id: 'cus_1' }) },
    invoices: { createPreview: async () => ({
      lines: { data: [
        { amount: -400, parent: { subscription_item_details: { proration: true } } },
        { amount: 1200, parent: { subscription_item_details: { proration: true } } },
      ] },
    }) },
    subscriptions: {
      retrieve: async () => subscription,
      update: async (_id: string, params: Stripe.SubscriptionUpdateParams, options?: Stripe.RequestOptions) => {
        updates.push({ params, options })
        return { ...subscription, pending_update: null }
      },
    },
    subscriptionSchedules: {
      create: async () => ({ id: 'sub_sched_1' }),
      retrieve: async () => ({ id: 'sub_sched_1', metadata: {} }),
      update: async () => ({ id: 'sub_sched_1' }),
    },
  } as unknown as Stripe
  const provider = new StripeBillingProvider({
    stripeClient,
    paidUnitPriceId: 'price_unit',
    portalConfigurationId: 'bpc_safe',
  })

  const result = await provider.changeSubscriptionPlan({
    userId: 'user_1',
    providerCustomerId: 'cus_1',
    providerSubscriptionId: 'sub_1',
    planId: 'pro',
    targetAmountCents: 2400,
    targetQuantity: 24,
    idempotencyKey: 'change_1',
  })

  assert.equal(result.direction, 'upgrade')
  assert.equal(result.prorationAmountCents, 800)
  assert.equal(result.applied, true)
  assert.equal(updates[0]?.params.payment_behavior, 'pending_if_incomplete')
  assert.equal(updates[0]?.params.proration_behavior, 'always_invoice')
  assert.deepEqual(updates[0]?.params.items, [{ id: 'si_1', quantity: 24 }])
  assert.equal(updates[0]?.options?.idempotencyKey, 'change_1')
})

test('StripeBillingProvider schedules downgrades for the current item renewal', async () => {
  const scheduleUpdates: Stripe.SubscriptionScheduleUpdateParams[] = []
  const subscription = subscriptionFixture(24)
  const stripeClient = {
    checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://stripe.test' }) } },
    billingPortal: {
      configurations: { retrieve: async () => ({ features: { subscription_update: { enabled: false } } }) },
      sessions: { create: async () => ({ id: 'bps_1', url: 'https://stripe.test/portal' }) },
    },
    customers: { retrieve: async () => ({ id: 'cus_1' }) },
    invoices: { createPreview: async () => ({ lines: { data: [] } }) },
    subscriptions: { retrieve: async () => subscription },
    subscriptionSchedules: {
      create: async () => ({ id: 'sub_sched_1', metadata: {}, current_phase: null }),
      retrieve: async () => ({ id: 'sub_sched_1', metadata: {}, current_phase: null }),
      update: async (_id: string, params: Stripe.SubscriptionScheduleUpdateParams) => {
        scheduleUpdates.push(params)
        return { id: 'sub_sched_1' }
      },
    },
  } as unknown as Stripe
  const provider = new StripeBillingProvider({
    stripeClient,
    paidUnitPriceId: 'price_unit',
    portalConfigurationId: 'bpc_safe',
  })

  const result = await provider.changeSubscriptionPlan({
    userId: 'user_1',
    providerSubscriptionId: 'sub_1',
    planId: 'starter',
    targetAmountCents: 800,
    targetQuantity: 8,
    idempotencyKey: 'change_2',
  })

  assert.equal(result.direction, 'downgrade')
  assert.equal(result.scheduled, true)
  assert.equal(result.effectiveAt, 1_702_592_000_000)
  assert.equal(scheduleUpdates[0]?.end_behavior, 'release')
  assert.equal(scheduleUpdates[0]?.phases?.[1]?.start_date, 1_702_592_000)
  assert.equal(scheduleUpdates[0]?.phases?.[1]?.items[0]?.quantity, 8)
})

test('StripeBillingProvider refuses a portal profile that allows quantity updates', async () => {
  const stripeClient = {
    checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://stripe.test' }) } },
    billingPortal: {
      configurations: { retrieve: async () => ({ features: { subscription_update: { enabled: true } } }) },
      sessions: { create: async () => ({ id: 'bps_1', url: 'https://stripe.test/portal' }) },
    },
  } as unknown as Stripe
  const provider = new StripeBillingProvider({
    stripeClient,
    paidUnitPriceId: 'price_unit',
    portalConfigurationId: 'bpc_unsafe',
  })

  await assert.rejects(
    () => provider.createCustomerPortalSession({ userId: 'user_1' }),
    /Stripe portal subscription updates must be disabled/,
  )
})
