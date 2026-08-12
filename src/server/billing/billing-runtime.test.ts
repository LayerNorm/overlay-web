import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canUsePaidBudgetFeatures,
  usesFreeTierPrivileges,
} from './billing-runtime'

test('free plans use free-tier privileges', () => {
  const entitlements = {
    tier: 'free' as const,
    planKind: 'free' as const,
    creditsUsed: 0,
    creditsTotal: 0,
    budgetUsedCents: 0,
    budgetTotalCents: 0,
    budgetRemainingCents: 0,
  }

  assert.equal(canUsePaidBudgetFeatures(entitlements), false)
  assert.equal(usesFreeTierPrivileges(entitlements), true)
})

test('paid plans with budget can use paid-budget features', () => {
  const entitlements = {
    tier: 'pro' as const,
    planKind: 'paid' as const,
    creditsUsed: 500,
    creditsTotal: 800,
    budgetUsedCents: 500,
    budgetTotalCents: 800,
    budgetRemainingCents: 300,
  }

  assert.equal(canUsePaidBudgetFeatures(entitlements), true)
  assert.equal(usesFreeTierPrivileges(entitlements), false)
})

test('paid plans with exhausted budget fall back to free-tier privileges', () => {
  const entitlements = {
    tier: 'pro' as const,
    planKind: 'paid' as const,
    creditsUsed: 800,
    creditsTotal: 800,
    budgetUsedCents: 800,
    budgetTotalCents: 800,
    budgetRemainingCents: 0,
    overlayStorageBytesLimit: 10_000_000_000,
  }

  assert.equal(canUsePaidBudgetFeatures(entitlements), false)
  assert.equal(usesFreeTierPrivileges(entitlements), true)
  assert.equal(entitlements.overlayStorageBytesLimit, 10_000_000_000)
})

test('auto top-up is skipped when the billing capability is disabled', async (t) => {
  // A billing-disabled deployment substitutes NoOpBillingProvider, but auto
  // top-up talks to Stripe directly. Without the capability gate this path
  // throws on the missing Stripe secret and 500s the whole act request.
  const saved = {
    deploymentEnv: process.env.OVERLAY_DEPLOYMENT_ENV,
    provider: process.env.BILLING_PROVIDER,
    capability: process.env.OVERLAY_CAPABILITY_BILLING,
    feature: process.env.OVERLAY_FEATURE_BILLING,
  }
  process.env.OVERLAY_DEPLOYMENT_ENV = 'test'
  process.env.BILLING_PROVIDER = 'none'
  process.env.OVERLAY_CAPABILITY_BILLING = '0'
  process.env.OVERLAY_FEATURE_BILLING = '0'

  const { clearOverlayRuntimeConfigCache } = await import('@/server/config')
  clearOverlayRuntimeConfigCache()

  t.after(() => {
    process.env.OVERLAY_DEPLOYMENT_ENV = saved.deploymentEnv
    process.env.BILLING_PROVIDER = saved.provider
    process.env.OVERLAY_CAPABILITY_BILLING = saved.capability
    process.env.OVERLAY_FEATURE_BILLING = saved.feature
    clearOverlayRuntimeConfigCache()
  })

  const { ensureBudgetAvailable } = await import('./billing-runtime')

  // Paid plan with an exhausted budget: the one shape that reaches auto top-up.
  // Reaching Stripe here would throw, so returning cleanly is the assertion.
  const result = await ensureBudgetAvailable({
    userId: 'user_billing_disabled',
    entitlements: {
      tier: 'pro' as const,
      planKind: 'paid' as const,
      creditsUsed: 800,
      creditsTotal: 800,
      budgetUsedCents: 800,
      budgetTotalCents: 800,
      budgetRemainingCents: 0,
    },
    minimumRequiredCents: 100,
  })

  assert.equal(result.autoTopUpApplied, false)
  assert.equal(result.autoTopUpReason, 'billing_disabled')
  assert.equal(result.remainingCents, 0)
})
