import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from './schema'
import { previewProviderBudgetSpent, recordPreviewProviderSpend } from './lib/previewProviderBudget'

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

test('one Preview budget counts spend across all wallets and survives synthetic refills', async () => {
  const { t, ids } = await fixture()
  // Legacy holds count until they are released; recorded spend counts for good.
  expect(await t.run(ctx => previewProviderBudgetSpent(ctx))).toBe(false)
  await t.run(async ctx => {
    await recordPreviewProviderSpend(ctx, 3_000_000)
    // A plan rollover or recovery cannot erase the independent spend counter.
    await ctx.db.patch(ids[0], { reservedMicros: 0, usedMicros: 0, includedMicros: 200_000_000 })
    await ctx.db.patch(ids[1], { usedMicros: 0, reservedMicros: 0 })
  })
  expect(await t.run(ctx => previewProviderBudgetSpent(ctx))).toBe(false)
  await t.run(ctx => recordPreviewProviderSpend(ctx, 1_000_000))
  expect(await t.run(ctx => previewProviderBudgetSpent(ctx))).toBe(true)
})

test('final provider settlement remains recordable above the cap', async () => {
  const { t } = await fixture()
  await t.run(ctx => recordPreviewProviderSpend(ctx, 10_000_000))
  expect(await t.run(ctx => previewProviderBudgetSpent(ctx))).toBe(true)
  const state = await t.run(ctx => ctx.db.query('previewProviderBudget').unique())
  expect(state?.spentMicros).toBe(11_000_000)
})

test('direct charges stop work once recorded Preview spend reaches the cap; Production never stops for it', async () => {
  const { t, ids } = await fixture()
  await t.run(async ctx => { await ctx.db.patch(ids[0], { reservedMicros: 0 }); await ctx.db.patch(ids[1], { reservedMicros: 0 }) })
  expect(await t.run(ctx => previewProviderBudgetSpent(ctx))).toBe(false)
  await t.run(ctx => recordPreviewProviderSpend(ctx, 4_000_000))
  expect(await t.run(ctx => previewProviderBudgetSpent(ctx))).toBe(true)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'production')
  expect(await t.run(ctx => previewProviderBudgetSpent(ctx))).toBe(false)
})

test('invalid Preview limits fail closed while Production does not read or write the guard', async () => {
  const { t } = await fixture()
  for (const value of ['0', '-1', '5000', 'invalid', '1.5']) {
    vi.stubEnv('OVERLAY_PREVIEW_PROVIDER_BUDGET_CENTS', value)
    await expect(t.run(ctx => previewProviderBudgetSpent(ctx))).rejects.toThrow('Invalid Preview provider budget')
  }
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'production')
  expect(await t.run(ctx => previewProviderBudgetSpent(ctx))).toBe(false)
  await t.run(ctx => recordPreviewProviderSpend(ctx, 100_000_000))
  expect(await t.run(ctx => ctx.db.query('previewProviderBudget').collect())).toHaveLength(0)
})
