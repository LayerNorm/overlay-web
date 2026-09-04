import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  NoOpBillingProvider,
  QuotaEnforcer,
  UsageMeter,
  canUsePaidBudgetFeatures,
  createFreeEntitlements,
  evaluateQuota,
  StripeBillingProvider,
} from './index'
import type { Entitlements, UsageArgs } from './index'

function paidEntitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    tier: 'pro',
    planKind: 'paid',
    creditsUsed: 100,
    creditsTotal: 500,
    budgetUsedCents: 100,
    budgetTotalCents: 500,
    budgetRemainingCents: 400,
    dailyUsage: { ask: 2, write: 0, agent: 0 },
    dailyLimits: { ask: 5, write: 5, agent: 2 },
    ...overrides,
  }
}

describe('@overlay/billing', () => {
  it('exposes free no-op billing provider defaults', async () => {
    const provider = new NoOpBillingProvider()
    const entitlements = await provider.getEntitlements('user_1')

    assert.deepEqual(entitlements, createFreeEntitlements())
    assert.equal(canUsePaidBudgetFeatures(entitlements), false)
    await assert.rejects(
      () => provider.createCheckoutSession({ userId: 'user_1' }),
      /Billing provider is disabled; checkout sessions are unavailable\./,
    )
    await assert.rejects(
      () => provider.createPortalSession('user_1'),
      /Billing provider is disabled; customer portal sessions are unavailable\./,
    )
  })

  it('records usage through UsageMeter with a timestamp', async () => {
    const recorded: UsageArgs[] = []
    const meter = new UsageMeter({
      async recordUsage(args) {
        recorded.push(args)
      },
    })

    await meter.recordUsage({ userId: 'user_1', type: 'ask', cost: 3 })

    assert.equal(recorded.length, 1)
    assert.equal(recorded[0]?.type, 'ask')
    assert.equal(typeof recorded[0]?.timestamp, 'number')
  })

  it('rejects exhausted daily quota and insufficient paid budget', () => {
    const dailyDecision = evaluateQuota(
      paidEntitlements({ dailyUsage: { ask: 5, write: 0, agent: 0 } }),
      { kind: 'ask' },
    )
    const budgetDecision = evaluateQuota(
      paidEntitlements({ budgetRemainingCents: 1 }),
      { minimumBudgetCents: 2 },
    )

    assert.equal(dailyDecision.allowed, false)
    assert.equal(dailyDecision.code, 'daily_limit_exceeded')
    assert.equal(budgetDecision.allowed, false)
    assert.equal(budgetDecision.code, 'insufficient_budget')
  })

  it('checks provider-backed quotas with QuotaEnforcer', async () => {
    const enforcer = new QuotaEnforcer({
      async getEntitlements() {
        return paidEntitlements()
      },
    })

    const decision = await enforcer.check({ userId: 'user_1', kind: 'ask', minimumBudgetCents: 50 })

    assert.equal(decision.allowed, true)
  })
})

it('creates and reuses one Stripe customer for workspace checkout', async () => {
  const checkoutParams: Record<string, unknown>[] = []
  const customerCreates: Record<string, unknown>[] = []
  let state: { stripeCustomerId?: string } = {}
  const provider = new StripeBillingProvider({
    stripe: {
      checkout: { sessions: { async create(params) {
        checkoutParams.push(params)
        return { id: `cs_${checkoutParams.length}`, url: 'https://stripe.test/checkout' }
      } } },
      billingPortal: { sessions: { async create() {
        return { id: 'bps_1', url: 'https://stripe.test/portal' }
      } } },
      customers: {
        async create(params) {
          customerCreates.push(params)
          return { id: 'cus_workspace' }
        },
        async retrieve(customerId) { return { id: customerId } },
      },
    },
    baseUrl: 'https://overlay.test',
    paidPlanPriceId: 'price_paid',
    normalizePlanAmountCents: (value) => value,
    normalizeTopUpAmountCents: (value) => value,
    getBillingAccountSubscriptionState: async () => state,
    syncBillingAccountCustomer: async (value) => { state = value },
  })

  const args = {
    userId: 'admin_1',
    billingAccountId: 'ba_workspace',
    workspaceId: 'workspace_1',
    email: 'admin@example.com',
    kind: 'paid_plan' as const,
    planAmountCents: 800,
    topUpAmountCents: 800,
  }
  await provider.createCheckoutSession(args)
  await provider.createCheckoutSession(args)

  assert.equal(customerCreates.length, 1)
  assert.equal(checkoutParams[0]?.customer, 'cus_workspace')
  assert.equal(checkoutParams[1]?.customer, 'cus_workspace')
  assert.equal((checkoutParams[0]?.metadata as Record<string, string>).billingAccountId, 'ba_workspace')
  assert.equal((checkoutParams[0]?.metadata as Record<string, string>).workspaceId, 'workspace_1')
})

it('creates named personal checkout with server-owned quantity metadata and integration id', async () => {
  const checkoutParams: Record<string, unknown>[] = []
  const provider = new StripeBillingProvider({
    stripe: {
      checkout: { sessions: { async create(params) {
        checkoutParams.push(params)
        return { id: 'cs_named', url: 'https://stripe.test/checkout' }
      } } },
      billingPortal: { sessions: { async create() {
        return { id: 'bps_1', url: 'https://stripe.test/portal' }
      } } },
    },
    baseUrl: 'https://overlay.test',
    paidPlanPriceId: 'price_paid',
    integrationIdentifier: () => 'payment_revision_abc123',
    normalizePlanAmountCents: (value) => value,
    normalizeTopUpAmountCents: (value) => value,
    planQuantityForAmountCents: (value) => value / 100,
  })

  await provider.createCheckoutSession({
    userId: 'user_1',
    email: 'user@example.com',
    kind: 'paid_plan',
    planId: 'pro',
    planAmountCents: 2400,
    topUpAmountCents: 800,
  })

  assert.equal(checkoutParams[0]?.integration_identifier, 'payment_revision_abc123')
  assert.deepEqual(checkoutParams[0]?.line_items, [{ price: 'price_paid', quantity: 24 }])
  assert.equal((checkoutParams[0]?.metadata as Record<string, string>).planId, 'pro')
  assert.equal((checkoutParams[0]?.metadata as Record<string, string>).stripeQuantity, '24')
})

it('verifies checkout ownership by billing account instead of workspace admin', async () => {
  const provider = new StripeBillingProvider({
    stripe: {
      checkout: { sessions: {
        async create() { return { id: 'unused', url: 'https://stripe.test' } },
        async retrieve() {
          return {
            id: 'cs_workspace',
            url: null,
            status: 'complete',
            mode: 'payment',
            payment_status: 'paid',
            currency: 'usd',
            amount_total: 800,
            metadata: {
              kind: 'budget_topup',
              userId: 'admin_1',
              billingAccountId: 'ba_other',
              workspaceId: 'workspace_1',
            },
          }
        },
      } },
      billingPortal: { sessions: { async create() {
        return { id: 'unused', url: 'https://stripe.test' }
      } } },
    },
    baseUrl: 'https://overlay.test',
  })

  await assert.rejects(
    provider.verifyCheckoutSession({
      sessionId: 'cs_workspace',
      userId: 'admin_1',
      billingAccountId: 'ba_workspace',
      workspaceId: 'workspace_1',
      kind: 'budget_topup',
    }),
    /Session mismatch/,
  )
})
