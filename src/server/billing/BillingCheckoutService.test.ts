import assert from 'node:assert/strict'
import test from 'node:test'
import { BillingCheckoutService } from './BillingCheckoutService'
import { BillingServiceError } from './BillingCustomerService'
import type { BillingRepository } from './BillingRepository'
import { LifecycleEventPublisher, LIFECYCLE_EVENT_TOPIC } from '@/server/lifecycle-events'
import type {
  BillingProvider,
  CheckoutArgs,
  CheckoutSessionVerificationArgs,
  UsageArgs,
} from '@overlay/app-core'
import type { EventBus } from '@overlay/app-core'
import { currentLegalAcceptancePayload } from '@/shared/legal/legal-documents'

class CapturingEventBus implements EventBus {
  readonly events: Array<{ payload: unknown; topic: string }> = []

  async publish(topic: string, payload: unknown): Promise<void> {
    this.events.push({ topic, payload })
  }

  subscribe(): () => void {
    return () => {}
  }
}

function createRepository(overrides: Partial<BillingRepository> = {}): BillingRepository {
  return {
    async listAdministrativeUsage() {
      return []
    },
    async adjustAdministrativeBudget() {
      throw new Error('not implemented in billing checkout fixture')
    },
    async getEntitlementsByServer() {
      return {
        tier: 'pro',
        planKind: 'paid',
        planAmountCents: 2000,
        budgetUsedCents: 0,
        budgetTotalCents: 2000,
        budgetRemainingCents: 2000,
        autoTopUpEnabled: false,
        autoTopUpAmountCents: 1000,
        autoTopUpConsentGranted: false,
        creditsUsed: 0,
        creditsTotal: 20,
      }
    },
    async getSubscriptionByUserIdByServer() {
      return null
    },
    async getSubscriptionByUserId() {
      return null
    },
    async updateBillingPreferences() {
      return { success: true }
    },
    async upsertSubscription() {
      return null
    },
    async listBudgetTopUpsByServer() {
      return []
    },
    async recordBudgetTopUp() {
      return null
    },
    ...overrides,
  }
}

function createBillingProvider(overrides: Partial<BillingProvider> = {}): BillingProvider {
  return {
    async getEntitlements() {
      return {
        tier: 'pro',
        planKind: 'paid',
        creditsUsed: 0,
        creditsTotal: 20,
        budgetUsedCents: 0,
        budgetTotalCents: 2000,
        budgetRemainingCents: 2000,
        dailyUsage: { ask: 0, write: 0, agent: 0 },
      }
    },
    async createCheckoutSession(args: CheckoutArgs) {
      return { url: `https://billing.example/${args.kind ?? 'paid_plan'}` }
    },
    async createPortalSession() {
      return { url: 'https://billing.example/portal' }
    },
    async verifyCheckoutSession(args: CheckoutSessionVerificationArgs) {
      if (args.kind === 'budget_topup') {
        return {
          providerSessionId: args.sessionId,
          amountTotalCents: 1000,
          autoTopUpEnabled: true,
        }
      }
      return {
        providerSessionId: args.sessionId,
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        providerPriceId: 'price_1',
        providerQuantity: 20,
        status: 'active',
        planAmountCents: 2000,
        topUpAmountCents: 1000,
        autoTopUpEnabled: true,
        offSessionConsentAt: 1234,
        currentPeriodStart: 100,
        currentPeriodEnd: 200,
      }
    },
    async recordUsage(args: UsageArgs) {
      void args
    },
    ...overrides,
  }
}

function createService(
  repository = createRepository(),
  billingProvider = createBillingProvider(),
  lifecycleEvents?: LifecycleEventPublisher,
) {
  return new BillingCheckoutService({
    repository,
    baseUrl: () => 'https://overlay.test',
    billingProvider,
    lifecycleEvents: lifecycleEvents ? () => lifecycleEvents : undefined,
  })
}

test('BillingCheckoutService.createSubscriptionCheckout preserves unsupported top-up error shape', async () => {
  const service = createService()

  await assert.rejects(
    () => service.createSubscriptionCheckout({
      user: { id: 'user_1', email: 'user@example.com' },
      body: { topUpAmountCents: 123, ...currentLegalAcceptancePayload() },
    }),
    (error) =>
      error instanceof BillingServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'Unsupported top-up amount.',
  )
})

test('BillingCheckoutService.createSubscriptionCheckout routes through billing provider', async () => {
  const calls: CheckoutArgs[] = []
  const service = createService(createRepository(), createBillingProvider({
    async createCheckoutSession(args) {
      calls.push(args)
      return { url: 'https://billing.example/checkout' }
    },
  }))

  const result = await service.createSubscriptionCheckout({
    user: { id: 'user_1', email: 'user@example.com' },
    body: {
      planId: 'pro',
      topUpAmountCents: 1000,
      autoTopUpEnabled: true,
      ...currentLegalAcceptancePayload(),
    },
  })

  assert.deepEqual(result, { url: 'https://billing.example/checkout' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.kind, 'paid_plan')
  assert.equal(calls[0]?.userId, 'user_1')
  assert.equal(calls[0]?.planId, 'pro')
  assert.equal(calls[0]?.planAmountCents, 2400)
  assert.equal(calls[0]?.topUpAmountCents, 1000)
})

test('BillingCheckoutService.createSubscriptionCheckout only accepts named plan ids or exact transition amounts', async () => {
  const calls: CheckoutArgs[] = []
  const service = createService(createRepository(), createBillingProvider({
    async createCheckoutSession(args) {
      calls.push(args)
      return { url: 'https://billing.example/checkout' }
    },
  }))

  await service.createSubscriptionCheckout({
    user: { id: 'user_1', email: 'user@example.com' },
    body: {
      planAmountCents: 800,
      topUpAmountCents: 1000,
      ...currentLegalAcceptancePayload(),
    },
  })
  assert.equal(calls[0]?.planId, 'starter')

  await assert.rejects(
    () => service.createSubscriptionCheckout({
      user: { id: 'user_1', email: 'user@example.com' },
      body: {
        planAmountCents: 1500,
        topUpAmountCents: 1000,
        ...currentLegalAcceptancePayload(),
      },
    }),
    (error) =>
      error instanceof BillingServiceError &&
      error.statusCode === 400 &&
      error.payload.code === 'unsupported_personal_plan',
  )
})

test('BillingCheckoutService.createSubscriptionCheckout blocks every non-canceled provider subscription', async () => {
  for (const status of ['active', 'trialing', 'past_due'] as const) {
    const service = createService(createRepository({
      async getSubscriptionByUserIdByServer() {
        return {
          userId: 'user_1',
          planKind: 'paid',
          planAmountCents: 1500,
          status,
          stripeSubscriptionId: 'sub_existing',
        }
      },
    }))

    await assert.rejects(
      () => service.createSubscriptionCheckout({
        user: { id: 'user_1', email: 'user@example.com' },
        body: {
          planId: 'pro',
          topUpAmountCents: 1000,
          ...currentLegalAcceptancePayload(),
        },
      }),
      (error) =>
        error instanceof BillingServiceError &&
        error.statusCode === 409 &&
        error.payload.code === 'subscription_exists' &&
        error.payload.action === (status === 'past_due' ? 'update_payment' : 'change_plan'),
    )
  }
})

test('BillingCheckoutService.createSubscriptionCheckout allows a new checkout after cancellation', async () => {
  let checkoutCalls = 0
  const service = createService(createRepository({
    async getSubscriptionByUserIdByServer() {
      return {
        userId: 'user_1',
        planKind: 'free',
        planAmountCents: 0,
        status: 'canceled',
        stripeSubscriptionId: 'sub_canceled',
      }
    },
  }), createBillingProvider({
    async createCheckoutSession() {
      checkoutCalls += 1
      return { url: 'https://billing.example/checkout' }
    },
  }))

  await service.createSubscriptionCheckout({
    user: { id: 'user_1', email: 'user@example.com' },
    body: {
      planId: 'starter',
      topUpAmountCents: 1000,
      ...currentLegalAcceptancePayload(),
    },
  })

  assert.equal(checkoutCalls, 1)
})

test('BillingCheckoutService.changeSubscriptionPlan previews legacy migration before confirmation', async () => {
  const service = createService(createRepository({
    async getSubscriptionByUserIdByServer() {
      return {
        userId: 'user_1',
        planKind: 'paid',
        planAmountCents: 1500,
        status: 'active',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripeQuantity: 15,
        currentPeriodEnd: 123_000,
      }
    },
  }), createBillingProvider({
    async previewSubscriptionPlanChange(args) {
      assert.equal(args.planId, 'pro')
      assert.equal(args.targetQuantity, 24)
      return {
        currency: 'usd',
        currentAmountCents: 1500,
        currentQuantity: 15,
        direction: 'upgrade',
        effectiveAt: 111_000,
        losesLegacyPricing: true,
        planId: 'pro',
        prorationAmountCents: 450,
        targetAmountCents: 2400,
        targetQuantity: 24,
      }
    },
  }))

  const result = await service.changeSubscriptionPlan({
    userId: 'user_1',
    body: { planId: 'pro' },
  })

  assert.deepEqual(result, {
    mode: 'preview',
    currency: 'usd',
    currentAmountCents: 1500,
    currentQuantity: 15,
    direction: 'upgrade',
    effectiveAt: 111_000,
    losesLegacyPricing: true,
    planId: 'pro',
    prorationAmountCents: 450,
    targetAmountCents: 2400,
    targetQuantity: 24,
  })
})

test('BillingCheckoutService.changeSubscriptionPlan applies a confirmed change and syncs local state', async () => {
  const upserts: Array<Record<string, unknown>> = []
  const service = createService(createRepository({
    async getSubscriptionByUserIdByServer() {
      return {
        userId: 'user_1',
        planKind: 'paid',
        planAmountCents: 800,
        status: 'active',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_unit',
        stripeQuantity: 8,
        currentPeriodEnd: 123_000,
      }
    },
    async upsertSubscription(args) {
      upserts.push(args)
      return null
    },
  }), createBillingProvider({
    async changeSubscriptionPlan() {
      return {
        applied: true,
        currency: 'usd',
        currentAmountCents: 800,
        currentQuantity: 8,
        direction: 'upgrade',
        effectiveAt: 111_000,
        losesLegacyPricing: false,
        paymentActionRequired: false,
        planId: 'pro',
        prorationAmountCents: 800,
        scheduled: false,
        targetAmountCents: 2400,
        targetQuantity: 24,
      }
    },
  }))

  const result = await service.changeSubscriptionPlan({
    userId: 'user_1',
    body: { planId: 'pro', confirmation: 'CHANGE_PLAN' },
  })

  assert.equal(result.mode, 'confirmed')
  assert.equal(result.applied, true)
  assert.equal(upserts[0]?.stripeQuantity, 24)
  assert.equal(upserts[0]?.planAmountCents, 2400)
})

test('BillingCheckoutService does not sync a failed upgrade before Stripe collects payment', async () => {
  const upserts: Array<Record<string, unknown>> = []
  const service = createService(createRepository({
    async getSubscriptionByUserIdByServer() {
      return {
        userId: 'user_1',
        planKind: 'paid',
        planAmountCents: 2400,
        status: 'active',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_unit',
        stripeQuantity: 24,
      }
    },
    async upsertSubscription(args) {
      upserts.push(args)
      return null
    },
  }), createBillingProvider({
    async changeSubscriptionPlan() {
      return {
        applied: false,
        currency: 'usd',
        currentAmountCents: 2400,
        currentQuantity: 24,
        direction: 'upgrade',
        effectiveAt: 111_000,
        losesLegacyPricing: false,
        paymentActionRequired: true,
        planId: 'max',
        prorationAmountCents: 3600,
        scheduled: false,
        targetAmountCents: 9600,
        targetQuantity: 96,
      }
    },
  }))

  const result = await service.changeSubscriptionPlan({
    userId: 'user_1',
    body: { planId: 'max', confirmation: 'CHANGE_PLAN' },
  })

  assert.equal(result.mode, 'confirmed')
  assert.equal(result.applied, false)
  assert.equal(result.paymentActionRequired, true)
  assert.equal(upserts.length, 0)
})

test('BillingCheckoutService.createTopUpCheckout requires paid plan', async () => {
  const service = createService(createRepository({
    async getEntitlementsByServer() {
      return {
        tier: 'free',
        planKind: 'free',
        planAmountCents: 0,
        budgetUsedCents: 0,
        budgetTotalCents: 0,
        budgetRemainingCents: 0,
        autoTopUpEnabled: false,
        autoTopUpAmountCents: 1000,
        autoTopUpConsentGranted: false,
        creditsUsed: 0,
        creditsTotal: 0,
      }
    },
  }))

  await assert.rejects(
    () => service.createTopUpCheckout({
      userId: 'user_1',
      body: { amountCents: 1000, ...currentLegalAcceptancePayload() },
    }),
    (error) =>
      error instanceof BillingServiceError &&
      error.statusCode === 403 &&
      error.payload.error === 'Top-ups require an active paid plan.',
  )
})

test('BillingCheckoutService.verifyTopUp preserves session validation errors', async () => {
  const service = createService()

  await assert.rejects(
    () => service.verifyTopUp({
      userId: 'user_1',
      body: {},
    }),
    (error) =>
      error instanceof BillingServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'Session ID required',
  )

  await assert.rejects(
    () => service.verifyTopUp({
      userId: 'user_1',
      body: { sessionId: 'bad_session' },
    }),
    (error) =>
      error instanceof BillingServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'Invalid session ID',
  )
})

test('BillingCheckoutService.verifySubscriptionCheckout writes provider verification result', async () => {
  const upserts: Array<Record<string, unknown>> = []
  const service = createService(createRepository({
    async upsertSubscription(args) {
      upserts.push(args)
      return null
    },
  }))

  const result = await service.verifySubscriptionCheckout({
    userId: 'user_1',
    sessionId: 'cs_test_123',
  })

  assert.deepEqual(result, {
    success: true,
    planKind: 'paid',
    planAmountCents: 2000,
    message: 'Subscription activated successfully',
  })
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0]?.stripeSubscriptionId, 'sub_1')
  assert.equal(upserts[0]?.stripePriceId, 'price_1')
})

test('BillingCheckoutService.verifyTopUp records provider verification result', async () => {
  const topUps: Array<Record<string, unknown>> = []
  const preferenceUpdates: Array<Record<string, unknown>> = []
  const service = createService(createRepository({
    async recordBudgetTopUp(args) {
      topUps.push(args)
      return null
    },
    async updateBillingPreferences(args) {
      preferenceUpdates.push(args)
      return { success: true }
    },
  }))

  const result = await service.verifyTopUp({
    userId: 'user_1',
    body: { sessionId: 'cs_test_123' },
  })

  assert.deepEqual(result, { success: true, amountCents: 1000 })
  assert.equal(topUps[0]?.stripeCheckoutSessionId, 'cs_test_123')
  assert.equal(preferenceUpdates[0]?.autoTopUpEnabled, true)
})

test('BillingCheckoutService emits identifier-only lifecycle events after committed billing updates', async () => {
  const eventBus = new CapturingEventBus()
  const service = createService(
    createRepository(),
    createBillingProvider(),
    new LifecycleEventPublisher({ eventBus }),
  )

  await service.verifySubscriptionCheckout({ userId: 'user_1', sessionId: 'cs_test_123' })
  await service.verifyTopUp({ userId: 'user_1', body: { sessionId: 'cs_test_123' } })

  assert.deepEqual(eventBus.events.map((event) => event.topic), [
    LIFECYCLE_EVENT_TOPIC,
    LIFECYCLE_EVENT_TOPIC,
  ])
  assert.deepEqual(eventBus.events.map((event) => {
    const payload = event.payload as {
      attributes: unknown
      name: string
      resource: unknown
    }
    return { attributes: payload.attributes, name: payload.name, resource: payload.resource }
  }), [
    {
      attributes: {
        changeSource: 'checkout_verification',
        planKind: 'paid',
        provider: 'stripe',
        status: 'active',
      },
      name: 'subscription.changed',
      resource: { id: 'sub_1', type: 'subscription' },
    },
    {
      attributes: { provider: 'stripe', source: 'manual' },
      name: 'topup.succeeded',
      resource: { id: 'cs_test_123', type: 'billing_topup' },
    },
  ])
})
