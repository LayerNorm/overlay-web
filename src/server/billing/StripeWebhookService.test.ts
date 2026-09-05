import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'
import type { EventBus } from '@overlay/app-core'
import { LifecycleEventPublisher, LIFECYCLE_EVENT_TOPIC } from '@/server/lifecycle-events'
import type { BillingRepository } from './BillingRepository'
import type { BillingProviderEventRepository, BillingWebhookRepository } from './BillingProviderEventRepository'
import { StripeWebhookService } from './StripeWebhookService'

class CapturingEventBus implements EventBus {
  readonly events: Array<{ payload: unknown; topic: string }> = []

  async publish(topic: string, payload: unknown): Promise<void> {
    this.events.push({ topic, payload })
  }

  subscribe(): () => void {
    return () => {}
  }
}

function acquiredEvents(): BillingProviderEventRepository {
  return {
    async reserve() { return { attempt: 1, status: 'acquired' as const } },
    async markProcessed() {},
    async markFailed() {},
  }
}

test('StripeWebhookService emits a top-up lifecycle event with identifiers only', async () => {
  const eventBus = new CapturingEventBus()
  const billing = {
    async recordBudgetTopUp() {
      return null
    },
    async resolveUserIdByProviderReference() {
      return 'user_1'
    },
    async resolveBillingAccountIdByProviderReference() {
      return null
    },
  } as unknown as BillingRepository & BillingWebhookRepository
  const events = {
    async reserve() {
      return { attempt: 1, status: 'acquired' as const }
    },
    async markProcessed() {},
    async markFailed() {},
  } satisfies BillingProviderEventRepository
  const service = new StripeWebhookService({
    billing,
    events,
    lifecycleEvents: new LifecycleEventPublisher({ eventBus }),
  })
  const event = {
    created: 1_700_000_000,
    data: {
      object: {
        amount_total: 1000,
        customer: 'cus_1',
        id: 'cs_1',
        metadata: { kind: 'budget_topup', userId: 'user_1' },
        payment_intent: 'pi_1',
        payment_status: 'paid',
      },
    },
    id: 'evt_1',
    type: 'checkout.session.completed',
  } as unknown as Stripe.Event

  assert.deepEqual(await service.handle({ event, rawBody: '{"id":"evt_1"}' }), {
    duplicate: false,
    handled: true,
  })
  assert.equal(eventBus.events[0]?.topic, LIFECYCLE_EVENT_TOPIC)
  assert.deepEqual(
    (() => {
      const payload = eventBus.events[0]?.payload as {
        attributes: unknown
        idempotencyKey: string
        name: string
        resource: unknown
        userId: string
      }
      return {
        attributes: payload.attributes,
        idempotencyKey: payload.idempotencyKey,
        name: payload.name,
        resource: payload.resource,
        userId: payload.userId,
      }
    })(),
    {
      attributes: { provider: 'stripe', source: 'manual' },
      idempotencyKey: 'topup.succeeded:stripe:evt_1',
      name: 'topup.succeeded',
      resource: { id: 'cs_1', type: 'billing_topup' },
      userId: 'user_1',
    },
  )
})

test('StripeWebhookService makes duplicate workspace top-up delivery a no-op', async () => {
  let writes = 0
  let reserved = false
  const billing = {
    async resolveBillingAccountIdByProviderReference() { return 'ba_workspace' },
    async getBillingAccountByIdByServer() {
      return {
        billingAccountId: 'ba_workspace',
        scope: 'workspace',
        workspaceId: 'workspace_1',
        primaryBillingContactUserId: 'admin_1',
        status: 'active',
      }
    },
    async recordBillingAccountTopUp() { writes += 1 },
  } as unknown as BillingRepository & BillingWebhookRepository
  const service = new StripeWebhookService({
    billing,
    events: {
      async reserve() {
        if (reserved) return { status: 'duplicate' as const, processed: true }
        reserved = true
        return { status: 'acquired' as const, attempt: 1 }
      },
      async markProcessed() {},
      async markFailed() {},
    },
  })
  const event = {
    created: 1_700_000_000,
    data: { object: {
      amount_total: 800,
      customer: 'cus_workspace',
      id: 'cs_workspace',
      metadata: {
        billingAccountId: 'ba_workspace',
        kind: 'budget_topup',
        userId: 'admin_1',
        workspaceId: 'workspace_1',
      },
      payment_intent: 'pi_workspace',
      payment_status: 'paid',
    } },
    id: 'evt_workspace_topup',
    type: 'checkout.session.completed',
  } as unknown as Stripe.Event

  assert.deepEqual(await service.handle({ event, rawBody: 'same' }), { duplicate: false, handled: true })
  assert.deepEqual(await service.handle({ event, rawBody: 'same' }), { duplicate: true, handled: true })
  assert.equal(writes, 1)
})

test('StripeWebhookService supplies event time so stale workspace subscription events cannot win', async () => {
  let lastProviderEventCreatedAt = 0
  let status: string | undefined
  const billing = {
    async resolveBillingAccountIdByProviderReference() { return 'ba_workspace' },
    async getBillingAccountByIdByServer() {
      return {
        billingAccountId: 'ba_workspace',
        scope: 'workspace',
        workspaceId: 'workspace_1',
        primaryBillingContactUserId: 'admin_1',
        status: 'active',
      }
    },
    async getBillingAccountSubscriptionByServer() {
      return { planKind: 'paid', planAmountCents: 800, status: 'active' }
    },
    async upsertBillingAccountSubscription(args: Record<string, unknown>) {
      const incoming = Number(args.providerEventCreatedAt ?? 0)
      if (incoming >= lastProviderEventCreatedAt) {
        lastProviderEventCreatedAt = incoming
        status = String(args.status)
      }
    },
  } as unknown as BillingRepository & BillingWebhookRepository
  const service = new StripeWebhookService({
    billing,
    events: {
      async reserve() { return { status: 'acquired' as const, attempt: 1 } },
      async markProcessed() {},
      async markFailed() {},
    },
  })
  const subscriptionEvent = (id: string, created: number, stripeStatus: string) => ({
    created,
    data: { object: {
      id: 'sub_workspace',
      customer: 'cus_workspace',
      metadata: {
        billingAccountId: 'ba_workspace',
        userId: 'admin_1',
        workspaceId: 'workspace_1',
        planAmountCents: '800',
      },
      items: { data: [{ quantity: 8, price: { id: 'price_paid' } }] },
      status: stripeStatus,
    } },
    id,
    type: 'customer.subscription.updated',
  }) as unknown as Stripe.Event

  await service.handle({ event: subscriptionEvent('evt_new', 200, 'active'), rawBody: 'new' })
  await service.handle({ event: subscriptionEvent('evt_old', 100, 'past_due'), rawBody: 'old' })

  assert.equal(lastProviderEventCreatedAt, 200_000)
  assert.equal(status, 'active')
})

test('StripeWebhookService creates the named-plan allowance for quantities 8, 24, and 96', async () => {
  const upserts: Array<Record<string, unknown>> = []
  const billing = {
    async resolveBillingAccountIdByProviderReference() { return null },
    async resolveUserIdByProviderReference() { return 'user_1' },
    async upsertSubscription(args: Record<string, unknown>) { upserts.push(args) },
  } as unknown as BillingRepository & BillingWebhookRepository
  const service = new StripeWebhookService({ billing, events: acquiredEvents() })

  for (const quantity of [8, 24, 96]) {
    const event = {
      created: 1_700_000_000,
      data: { object: {
        customer: 'cus_1',
        id: `cs_${quantity}`,
        metadata: {
          kind: 'paid_plan',
          planAmountCents: String(quantity * 100),
          planId: quantity === 8 ? 'starter' : quantity === 24 ? 'pro' : 'max',
          planVersion: 'variable_v2',
          stripeQuantity: String(quantity),
          userId: 'user_1',
        },
        payment_status: 'paid',
        subscription: `sub_${quantity}`,
      } },
      id: `evt_checkout_${quantity}`,
      type: 'checkout.session.completed',
    } as unknown as Stripe.Event

    assert.deepEqual(await service.handle({ event, rawBody: `checkout-${quantity}` }), {
      duplicate: false,
      handled: true,
    })
  }

  assert.deepEqual(upserts.map(({ planAmountCents, stripeQuantity }) => ({
    planAmountCents,
    stripeQuantity,
  })), [
    { planAmountCents: 800, stripeQuantity: 8 },
    { planAmountCents: 2400, stripeQuantity: 24 },
    { planAmountCents: 9600, stripeQuantity: 96 },
  ])
})

test('StripeWebhookService ignores unpaid subscription checkout completion', async () => {
  let writes = 0
  const billing = {
    async resolveBillingAccountIdByProviderReference() { return null },
    async resolveUserIdByProviderReference() { return 'user_1' },
    async upsertSubscription() { writes += 1 },
  } as unknown as BillingRepository & BillingWebhookRepository
  const service = new StripeWebhookService({ billing, events: acquiredEvents() })
  const event = {
    created: 1_700_000_000,
    data: { object: {
      customer: 'cus_1',
      id: 'cs_unpaid',
      metadata: {
        kind: 'paid_plan',
        planAmountCents: '9600',
        stripeQuantity: '96',
        userId: 'user_1',
      },
      payment_status: 'unpaid',
      subscription: 'sub_unpaid',
    } },
    id: 'evt_checkout_unpaid',
    type: 'checkout.session.completed',
  } as unknown as Stripe.Event

  assert.deepEqual(await service.handle({ event, rawBody: 'checkout-unpaid' }), {
    duplicate: false,
    handled: false,
  })
  assert.equal(writes, 0)
})

test('StripeWebhookService withholds a new incomplete subscription allowance until payment recovery', async () => {
  const upserts: Array<Record<string, unknown>> = []
  const billing = {
    async resolveBillingAccountIdByProviderReference() { return null },
    async resolveUserIdByProviderReference() { return 'user_1' },
    async getSubscriptionByUserIdByServer() { return null },
    async upsertSubscription(args: Record<string, unknown>) { upserts.push(args) },
  } as unknown as BillingRepository & BillingWebhookRepository
  const service = new StripeWebhookService({ billing, events: acquiredEvents() })
  const subscriptionEvent = (id: string, status: string) => ({
    created: 1_700_000_000,
    data: { object: {
      customer: 'cus_1',
      id: 'sub_1',
      items: { data: [{
        current_period_end: 1_702_592_000,
        current_period_start: 1_700_000_000,
        price: { id: 'price_unit' },
        quantity: 24,
      }] },
      metadata: { planAmountCents: '2400', planVersion: 'variable_v2', userId: 'user_1' },
      cancel_at_period_end: status === 'active',
      status,
    } },
    id,
    type: status === 'incomplete' ? 'customer.subscription.created' : 'customer.subscription.updated',
  }) as unknown as Stripe.Event

  await service.handle({ event: subscriptionEvent('evt_incomplete', 'incomplete'), rawBody: 'incomplete' })
  await service.handle({ event: subscriptionEvent('evt_recovered', 'active'), rawBody: 'active' })

  assert.deepEqual(upserts.map(({ cancelAtPeriodEnd, planAmountCents, planKind, status }) => ({
    cancelAtPeriodEnd,
    planAmountCents,
    planKind,
    status,
  })), [
    { cancelAtPeriodEnd: false, planAmountCents: 0, planKind: 'free', status: 'past_due' },
    { cancelAtPeriodEnd: true, planAmountCents: 2400, planKind: 'paid', status: 'active' },
  ])
})

test('StripeWebhookService preserves the paid allowance during recovery and clears it on cancellation', async () => {
  const upserts: Array<Record<string, unknown>> = []
  const existing = {
    autoTopUpAmountCents: 800,
    autoTopUpEnabled: true,
    offSessionConsentAt: 123,
    planAmountCents: 2400,
    planKind: 'paid' as const,
    stripeQuantity: 24,
    tier: 'pro' as const,
  }
  const billing = {
    async resolveBillingAccountIdByProviderReference() { return null },
    async resolveUserIdByProviderReference() { return 'user_1' },
    async getSubscriptionByUserIdByServer() { return existing },
    async upsertSubscription(args: Record<string, unknown>) { upserts.push(args) },
  } as unknown as BillingRepository & BillingWebhookRepository
  const service = new StripeWebhookService({ billing, events: acquiredEvents() })
  const subscriptionEvent = (id: string, status: string, deleted = false) => ({
    created: 1_700_000_000,
    data: { object: {
      customer: 'cus_1',
      id: 'sub_1',
      items: { data: [{
        current_period_end: 1_702_592_000,
        current_period_start: 1_700_000_000,
        price: { id: 'price_unit' },
        quantity: 96,
      }] },
      metadata: { planAmountCents: '9600', planVersion: 'variable_v2', userId: 'user_1' },
      status,
    } },
    id,
    type: deleted ? 'customer.subscription.deleted' : 'customer.subscription.updated',
  }) as unknown as Stripe.Event

  await service.handle({ event: subscriptionEvent('evt_failed_upgrade', 'past_due'), rawBody: 'past-due' })
  await service.handle({ event: subscriptionEvent('evt_canceled', 'canceled', true), rawBody: 'canceled' })

  assert.deepEqual(upserts.map(({ autoTopUpEnabled, planAmountCents, planKind, status, stripeQuantity }) => ({
    autoTopUpEnabled,
    planAmountCents,
    planKind,
    status,
    stripeQuantity,
  })), [
    { autoTopUpEnabled: true, planAmountCents: 2400, planKind: 'paid', status: 'past_due', stripeQuantity: 24 },
    { autoTopUpEnabled: false, planAmountCents: 0, planKind: 'free', status: 'canceled', stripeQuantity: 96 },
  ])
})
