import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from './schema'
import { ensureWorkspaceBillingAccount } from './billing/accountModel'
import { applyMarkupToDollars } from './lib/usageMarkup'

const modules = import.meta.glob('./**/*.ts')
afterEach(() => vi.unstubAllEnvs())

test('backend usage reads the configured rate and account creation leaves existing accounts and credit untouched', async () => {
  const t = convexTest(schema, modules)
  const owner = { workspaceId: 'markup-fixture', primaryBillingContactUserId: 'operator' }
  vi.stubEnv('OVERLAY_USAGE_MARKUP_BPS', '2500')
  expect(applyMarkupToDollars({ providerCostUsd: 8 })).toBe(1000)
  const original = await t.run(ctx => ensureWorkspaceBillingAccount(ctx, owner))
  const before = await t.run(ctx => ctx.db.query('billingAccountBalances').collect())
  vi.stubEnv('OVERLAY_USAGE_MARKUP_BPS', '5000')
  expect(applyMarkupToDollars({ providerCostUsd: 8 })).toBe(1200)
  expect(await t.run(ctx => ensureWorkspaceBillingAccount(ctx, owner))).toEqual(original)
  expect(await t.run(ctx => ctx.db.query('billingAccountBalances').collect())).toEqual(before)
  const next = await t.run(ctx => ensureWorkspaceBillingAccount(ctx, { ...owner, workspaceId: 'new-markup-fixture' }))
  expect(next.markupBasisPoints).toBe(5000)
})

test('missing backend pricing prevents new billing accounts and provider charges without partial writes', async () => {
  const t = convexTest(schema, modules)
  vi.stubEnv('OVERLAY_USAGE_MARKUP_BPS', '')
  expect(() => applyMarkupToDollars({ providerCostUsd: 8 })).toThrow(/OVERLAY_USAGE_MARKUP_BPS/)
  await expect(t.run(ctx => ensureWorkspaceBillingAccount(ctx, {
    workspaceId: 'missing-rate', primaryBillingContactUserId: 'operator',
  }))).rejects.toThrow(/OVERLAY_USAGE_MARKUP_BPS/)
  expect(await t.run(ctx => ctx.db.query('billingAccounts').collect())).toEqual([])
  expect(await t.run(ctx => ctx.db.query('billingAccountBalances').collect())).toEqual([])
})
