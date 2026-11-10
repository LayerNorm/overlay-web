import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePayer: vi.fn(), accountEntitlements: vi.fn(), userEntitlements: vi.fn(), spendLimit: vi.fn(),
  topUp: vi.fn(), recordBatch: vi.fn(), reserve: vi.fn(), reserveWorkspace: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/security-events', () => ({ logSecurityEvent: vi.fn() }))
vi.mock('@/server/env/usage-markup', () => ({ configuredUsageMarkupBasisPoints: () => 2500 }))
vi.mock('@/server/capabilities', () => ({ getOverlayCapabilities: async () => ({ billing: true }) }))
vi.mock('@/server/billing/stripe-billing', () => ({ maybeAutoTopUpWorkspaceBudget: mocks.topUp }))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    billingPayerResolver: { resolve: mocks.resolvePayer },
    appData: { repositories: {
      billing: {
        getBillingAccountEntitlementsByServer: mocks.accountEntitlements,
        getEntitlementsByServer: mocks.userEntitlements,
        getBillingAccountSpendLimitByServer: mocks.spendLimit,
        getBillingAccountSubscriptionByServer: vi.fn(async () => null),
      },
      usage: { recordBatch: mocks.recordBatch, reserve: mocks.reserve, reserveWorkspace: mocks.reserveWorkspace },
    } },
  }),
}))

import { chargeProviderUsage, ensureProviderBudgetNotLow } from './billing-runtime'

const balance = (remainingCents: number) => ({
  tier: 'pro', planKind: 'paid', creditsUsed: 0, creditsTotal: 100,
  budgetTotalCents: 10_000, budgetUsedCents: 10_000 - remainingCents, budgetRemainingCents: remainingCents,
}) as never

const check = (overrides: Partial<Parameters<typeof ensureProviderBudgetNotLow>[0]> = {}) => ensureProviderBudgetNotLow({
  userId: 'user', entitlements: balance(5_000), kind: 'transcription', modelId: 'groq/whisper', operationId: 'audio.transcribe',
  workspaceId: 'workspace', requireExecution: (async () => ({ billingEnabled: true })) as never, ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolvePayer.mockResolvedValue({
    scope: 'workspace', billingAccountId: 'account', workspaceId: 'workspace', subject: { kind: 'member', id: 'user' },
  })
  mocks.userEntitlements.mockResolvedValue(null)
  mocks.spendLimit.mockResolvedValue(null)
})

test('a workspace with 2% or more left runs without a top-up, an estimate or a hold', async () => {
  mocks.accountEntitlements.mockResolvedValue(balance(200)) // exactly 2% of $100
  expect(await check()).toMatchObject({ ok: true })
  expect(mocks.topUp).not.toHaveBeenCalled()
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.reserveWorkspace).not.toHaveBeenCalled()
})

test('under 2% it tops up to the 2% line first, and refuses only when the top-up fails', async () => {
  mocks.accountEntitlements.mockResolvedValue(balance(150))
  mocks.topUp.mockResolvedValue({ applied: false, reason: 'missing_payment_method' })
  const refused = await check()
  expect(refused).toMatchObject({ ok: false, status: 402, code: 'insufficient_budget',
    payload: { resourceStatus: { reason: 'missing_payment_method', requiredCents: 200, remainingCents: 150 } } })
  // The target balance passed to the top-up is the 2% stop line, not a cost estimate.
  expect(mocks.topUp).toHaveBeenCalledWith(expect.objectContaining({ billingAccountId: 'account', workspaceId: 'workspace' }), expect.anything())
  expect(mocks.reserveWorkspace).not.toHaveBeenCalled()

  mocks.topUp.mockResolvedValue({ applied: true })
  mocks.accountEntitlements.mockResolvedValueOnce(balance(150)).mockResolvedValueOnce(balance(2_150))
  expect(await check()).toMatchObject({ ok: true })
})

test('a member whose admin spend limit is used up is refused even with budget left', async () => {
  mocks.accountEntitlements.mockResolvedValue(balance(5_000))
  const now = Date.now()
  mocks.spendLimit.mockResolvedValue({ limitCents: 500, usedCents: 500, reservedCents: 0, periodStart: now - 1_000, periodEnd: now + 60_000 })
  expect(await check()).toMatchObject({ ok: false, status: 402, payload: { resourceStatus: { reason: 'spend_limit_exceeded' } } })
  mocks.spendLimit.mockResolvedValue({ limitCents: 500, usedCents: 100, reservedCents: 0, periodStart: now - 1_000, periodEnd: now + 60_000 })
  expect(await check()).toMatchObject({ ok: true })
})

test('billing-disabled deployments are never checked', async () => {
  expect(await check({ requireExecution: (async () => ({ billingEnabled: false })) as never })).toMatchObject({ ok: true })
  expect(mocks.resolvePayer).not.toHaveBeenCalled()
})

test('the actual cost is charged directly with recordBatch and reports budgetLow', async () => {
  mocks.recordBatch.mockResolvedValue({ recorded: 1, budgetLow: true })
  expect(await chargeProviderUsage({
    userId: 'user', workspaceId: 'workspace', programmaticSubjectId: 'agent:a', operationId: 'audio.transcribe:1',
    providerCostUsd: 0.01, usage: { kind: 'transcription', modelId: 'groq/whisper', durationSeconds: 30 },
  })).toEqual({ budgetLow: true })
  expect(mocks.recordBatch).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user', workspaceId: 'workspace', programmaticSubjectId: 'agent:a', operationId: 'audio.transcribe:1',
    events: [expect.objectContaining({ kind: 'transcription', costCents: 1.25, providerCostUsd: 0.01, durationSeconds: 30 })],
  }))
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.reserveWorkspace).not.toHaveBeenCalled()
  await expect(chargeProviderUsage({
    userId: 'user', operationId: 'bad', providerCostUsd: -1, usage: { kind: 'generation' },
  })).rejects.toThrow(/Invalid provider cost/)
})
