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

function safePortalFeatures() {
  return {
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    subscription_update: { enabled: false },
  }
}

test('StripeBillingProvider invoices upgrades now with pending-update payment protection', async () => {
  const updates: Array<{ params: Stripe.SubscriptionUpdateParams; options?: Stripe.RequestOptions }> = []
  const subscription = subscriptionFixture(8)
  const stripeClient = {
    checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://stripe.test' }) } },
    billingPortal: {
      configurations: { retrieve: async () => ({ features: safePortalFeatures() }) },
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
      configurations: { retrieve: async () => ({ features: safePortalFeatures() }) },
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

test('StripeBillingProvider leaves a failed upgrade pending instead of granting its target plan', async () => {
  const subscription = subscriptionFixture(24)
  const stripeClient = {
    checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://stripe.test' }) } },
    billingPortal: {
      configurations: { retrieve: async () => ({ features: safePortalFeatures() }) },
      sessions: { create: async () => ({ id: 'bps_1', url: 'https://stripe.test/portal' }) },
    },
    invoices: { createPreview: async () => ({
      lines: { data: [{ amount: 3600, parent: { subscription_item_details: { proration: true } } }] },
    }) },
    subscriptions: {
      retrieve: async () => subscription,
      update: async () => ({ ...subscription, pending_update: { expires_at: 1_700_086_400 } }),
    },
  } as unknown as Stripe
  const provider = new StripeBillingProvider({ stripeClient, paidUnitPriceId: 'price_unit' })

  const result = await provider.changeSubscriptionPlan({
    userId: 'user_1',
    providerCustomerId: 'cus_1',
    providerSubscriptionId: 'sub_1',
    planId: 'max',
    targetAmountCents: 9600,
    targetQuantity: 96,
  })

  assert.equal(result.direction, 'upgrade')
  assert.equal(result.applied, false)
  assert.equal(result.paymentActionRequired, true)
  assert.equal(result.targetQuantity, 96)
})

test('StripeBillingProvider rejects plan changes while cancellation is scheduled', async () => {
  const subscription = { ...subscriptionFixture(24), cancel_at_period_end: true }
  const stripeClient = {
    checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://stripe.test' }) } },
    subscriptions: { retrieve: async () => subscription },
  } as unknown as Stripe
  const provider = new StripeBillingProvider({ stripeClient, paidUnitPriceId: 'price_unit' })

  await assert.rejects(
    () => provider.previewSubscriptionPlanChange({
      userId: 'user_1',
      providerSubscriptionId: 'sub_1',
      planId: 'max',
      targetAmountCents: 9_600,
      targetQuantity: 96,
    }),
    /Canceling subscriptions cannot schedule a plan change/,
  )
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

test('StripeBillingProvider refuses a portal profile that cancels immediately', async () => {
  const stripeClient = {
    checkout: { sessions: { create: async () => ({ id: 'cs_1', url: 'https://stripe.test' }) } },
    billingPortal: {
      configurations: { retrieve: async () => ({
        features: {
          ...safePortalFeatures(),
          subscription_cancel: { enabled: true, mode: 'immediately' },
        },
      }) },
      sessions: { create: async () => ({ id: 'bps_1', url: 'https://stripe.test/portal' }) },
    },
  } as unknown as Stripe
  const provider = new StripeBillingProvider({
    stripeClient,
    paidUnitPriceId: 'price_unit',
    portalConfigurationId: 'bpc_immediate',
  })

  await assert.rejects(
    () => provider.createCustomerPortalSession({ userId: 'user_1' }),
    /Stripe portal subscription cancellation must occur at period end/,
  )
})

test('StripeBillingProvider creates a recovery and cancellation portal session', async () => {
  const portalCreates: Stripe.BillingPortal.SessionCreateParams[] = []
  const stripeClient = {
    checkout: { sessions: {
      create: async () => ({ id: 'cs_1', url: 'https://stripe.test' }),
      retrieve: async () => ({
        id: 'cs_paid',
        customer: 'cus_1',
        metadata: { kind: 'paid_plan', userId: 'user_1' },
      }),
    } },
    billingPortal: {
      configurations: { retrieve: async () => ({ features: safePortalFeatures() }) },
      sessions: {
        create: async (params: Stripe.BillingPortal.SessionCreateParams) => {
          portalCreates.push(params)
          return { id: 'bps_1', url: 'https://stripe.test/portal' }
        },
      },
    },
    customers: { retrieve: async () => ({ id: 'cus_1' }) },
  } as unknown as Stripe
  const provider = new StripeBillingProvider({
    stripeClient,
    paidUnitPriceId: 'price_unit',
    portalConfigurationId: 'bpc_safe',
  })

  const result = await provider.createCustomerPortalSession({
    userId: 'user_1',
    sessionId: 'cs_paid',
    returnUrl: 'https://overlay.test/account',
  })

  assert.equal(result.url, 'https://stripe.test/portal')
  assert.deepEqual(portalCreates[0], {
    configuration: 'bpc_safe',
    customer: 'cus_1',
    return_url: 'https://overlay.test/account',
  })
})
