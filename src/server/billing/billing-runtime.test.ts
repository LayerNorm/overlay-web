import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canUsePaidBudgetFeatures,
  reserveProviderBudget,
  billableBudgetCentsFromProviderUsd,
  billableBudgetCentsFromProviderCents,
} from './billing-runtime'
import { WorkspaceExecutionError } from './WorkspaceExecutionPolicy'

test('unsubscribed workspaces cannot use paid-budget features', () => {
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
})

test('paid plans with exhausted budget have no execution privileges', () => {
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
  assert.equal(entitlements.overlayStorageBytesLimit, 10_000_000_000)
})

test('provider reservations check execution policy before the zero-cost fast path', async () => {
  const input = {
    userId: 'user_1',
    entitlements: {
      tier: 'free' as const,
      planKind: 'free' as const,
      creditsUsed: 0,
      creditsTotal: 0,
      budgetUsedCents: 0,
      budgetTotalCents: 0,
      budgetRemainingCents: 0,
    },
    providerCostUsd: 0,
    kind: 'ask' as const,
    operationId: 'operation_1',
    requestFingerprint: 'fingerprint_1',
    requireExecution: async () => {
      throw new WorkspaceExecutionError({ state: 'subscription_required', canExecute: false }, true)
    },
  }

  await assert.rejects(
    reserveProviderBudget(input),
    (error: unknown) => error instanceof WorkspaceExecutionError && error.statusCode === 402,
  )
})

test('billing-disabled provider requests return without creating a reservation', async () => {
  const result = await reserveProviderBudget({
    userId: 'user_1',
    entitlements: {
      tier: 'free',
      planKind: 'free',
      creditsUsed: 0,
      creditsTotal: 0,
      budgetUsedCents: 0,
      budgetTotalCents: 0,
      budgetRemainingCents: 0,
    },
    providerCostUsd: 1,
    kind: 'ask',
    operationId: 'operation_1',
    requestFingerprint: 'fingerprint_1',
    requireExecution: async () => ({ billingEnabled: false }) as never,
  })

  assert.equal(result.ok, true)
  assert.equal(result.reservationId, null)
  assert.equal(result.reservedCents, 0)
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

  // An exhausted budget never reaches Stripe: a person's own account has no automatic top-ups.
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
  assert.equal(result.remainingCents, 0)
})


test('web usage billing reads the configured rate with no hardcoded fallback', (t) => {
  const original = process.env.OVERLAY_USAGE_MARKUP_BPS
  t.after(() => {
    if (original === undefined) delete process.env.OVERLAY_USAGE_MARKUP_BPS
    else process.env.OVERLAY_USAGE_MARKUP_BPS = original
  })
  process.env.OVERLAY_USAGE_MARKUP_BPS = '5000'
  assert.equal(billableBudgetCentsFromProviderUsd(8), 1200)
  assert.equal(billableBudgetCentsFromProviderCents(800), 1200)
  process.env.OVERLAY_USAGE_MARKUP_BPS = '0'
  assert.equal(billableBudgetCentsFromProviderUsd(8), 800)
  delete process.env.OVERLAY_USAGE_MARKUP_BPS
  assert.throws(() => billableBudgetCentsFromProviderUsd(8), /OVERLAY_USAGE_MARKUP_BPS/)
})
