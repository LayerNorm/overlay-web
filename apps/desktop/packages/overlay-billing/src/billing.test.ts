import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  NoOpBillingProvider,
  QuotaEnforcer,
  UsageMeter,
  canUsePaidBudgetFeatures,
  createFreeEntitlements,
  evaluateQuota,
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
