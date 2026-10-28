import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { previewProviderBudgetAvailable, recordPreviewProviderSpend } from './lib/previewProviderBudget'

const modules = import.meta.glob('./**/*.ts')
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('OVERLAY_PREVIEW_PROVIDER_BUDGET_CENTS', '500')
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => Promise.all(['wallet-a', 'wallet-b'].map((billingAccountId, index) =>
    ctx.db.insert('billingAccountBalances', { billingAccountId, mode: 'budgeted', includedMicros: 100_000_000,
      institutionalGrantMicros: 0, allowanceUsedMicros: index ? 1_000_000 : 0, topUpPurchasedMicros: 0,
      topUpBalanceMicros: 0, usedMicros: index ? 1_000_000 : 0, reservedMicros: 500_000,
      version: 1, createdAt: 1, updatedAt: 1 }))))
  return { t, ids }
}

test('one Preview budget covers all wallets and concurrent holds even after synthetic refills', async () => {
  const { t, ids } = await fixture()
  expect(await t.run(ctx => previewProviderBudgetAvailable(ctx, 3_000_000))).toBe(true)
  await t.run(async ctx => {
    expect(await previewProviderBudgetAvailable(ctx, 2_000_000)).toBe(true)
    await ctx.db.patch(ids[0], { reservedMicros: 2_500_000 })
  })
  expect(await t.run(ctx => previewProviderBudgetAvailable(ctx, 2_000_000))).toBe(false)
  await t.run(async ctx => {
    await recordPreviewProviderSpend(ctx, 2_000_000)
    // A plan rollover or recovery cannot erase the independent spend counter.
    await ctx.db.patch(ids[0], { reservedMicros: 0, usedMicros: 0, includedMicros: 200_000_000 })
    await ctx.db.patch(ids[1], { usedMicros: 0 })
  })
  expect(await t.run(ctx => previewProviderBudgetAvailable(ctx, 1_500_001))).toBe(false)
  expect(await t.run(ctx => previewProviderBudgetAvailable(ctx, 1_500_000))).toBe(true)
})

test('final provider settlement remains recordable above the cap and blocks further admission', async () => {
  const { t } = await fixture()
  await t.run(ctx => recordPreviewProviderSpend(ctx, 10_000_000))
  expect(await t.run(ctx => previewProviderBudgetAvailable(ctx, 1))).toBe(false)
  const state = await t.run(ctx => ctx.db.query('previewProviderBudget').unique())
  expect(state?.spentMicros).toBe(11_000_000)
})

test('invalid Preview limits fail closed while Production does not read or write the guard', async () => {
  const { t } = await fixture()
  for (const value of ['0', '-1', '5000', 'invalid', '1.5']) {
    vi.stubEnv('OVERLAY_PREVIEW_PROVIDER_BUDGET_CENTS', value)
    await expect(t.run(ctx => previewProviderBudgetAvailable(ctx, 1))).rejects.toThrow('Invalid Preview provider budget')
  }
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'production')
  expect(await t.run(ctx => previewProviderBudgetAvailable(ctx, 100_000_000))).toBe(true)
  await t.run(ctx => recordPreviewProviderSpend(ctx, 100_000_000))
  expect(await t.run(ctx => ctx.db.query('previewProviderBudget').collect())).toHaveLength(0)
})

test('real reservation admission rejects a second wallet when their combined commitments exceed the PR budget', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('OVERLAY_PREVIEW_PROVIDER_BUDGET_CENTS', '20')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_budget_qa')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'qa@example.test')
  vi.stubEnv('INTERNAL_API_SECRET', 'preview-budget-test-secret')
  const t = convexTest(schema, modules)
  const paid = await t.mutation(makeFunctionReference<'mutation'>('dev/seed:initQa'), {})
  const computer = await t.mutation(makeFunctionReference<'mutation'>('dev/seed:initComputerQa'), {})
  const accounts = await t.run(ctx => ctx.db.query('billingAccounts').collect())
  const reserve = (workspaceId: string, cents: number, id: string) => t.mutation(
    makeFunctionReference<'mutation'>('platform/usage:reserveWorkspaceBudgetByServer'), {
      serverSecret: 'preview-budget-test-secret', workspaceId, userId: 'user_budget_qa',
      billingAccountId: accounts.find(account => account.workspaceId === workspaceId)!.billingAccountId,
      spendSubjectKind: 'member', spendSubjectId: 'user_budget_qa', kind: 'generation',
      operationId: id, requestFingerprint: id, reservationId: id, reservedCents: cents,
    })
  await reserve(paid.workspaceId, 15, 'preview-budget-one')
  await expect(reserve(computer.workspaceId, 10, 'preview-budget-two')).rejects.toThrow('preview_provider_budget_exhausted')
  expect(await t.run(ctx => ctx.db.query('budgetReservations').collect())).toHaveLength(1)
  await t.mutation(makeFunctionReference<'mutation'>('platform/usage:releaseBudgetReservationByServer'), {
    serverSecret: 'preview-budget-test-secret', userId: 'user_budget_qa', reservationId: 'preview-budget-one',
  })
  await reserve(computer.workspaceId, 10, 'preview-budget-two')
  expect(await t.run(ctx => ctx.db.query('budgetReservations').collect())).toHaveLength(2)
})
