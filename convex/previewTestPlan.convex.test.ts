import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { ensureWorkspaceBillingAccount } from './billing/accountModel'

const modules = import.meta.glob('./**/*.ts')
const grant = makeFunctionReference<'mutation'>('billing/previewTestPlan:grantByServer')
const secret = 'preview-plan-secret'
afterEach(() => vi.unstubAllEnvs())

async function workspaceWithWallet(t: ReturnType<typeof convexTest>) {
  return await t.run(async ctx => {
    const account = await ensureWorkspaceBillingAccount(ctx, { workspaceId: 'ws-qa', primaryBillingContactUserId: 'user_qa' })
    return account.billingAccountId
  })
}

test.each(['production', 'development', 'staging', ''])('a test plan is refused on %s, with no writes', async environment => {
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await workspaceWithWallet(t)
  await expect(t.mutation(grant, { serverSecret: secret, workspaceId: 'ws-qa' })).rejects.toThrow('Preview seed is unavailable')
  expect(await t.run(ctx => ctx.db.query('billingAccountSubscriptions').collect())).toEqual([])
})

test('a preview workspace becomes paid once, and granting again never refills the allowance', async () => {
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  const t = convexTest(schema, modules)
  const billingAccountId = await workspaceWithWallet(t)
  await expect(t.mutation(grant, { serverSecret: 'wrong', workspaceId: 'ws-qa' })).rejects.toThrow('Unauthorized')
  expect(await t.mutation(grant, { serverSecret: secret, workspaceId: 'ws-qa' })).toEqual({ granted: true })
  await t.run(async ctx => {
    const subscription = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', q => q.eq('billingAccountId', billingAccountId)).unique()
    expect(subscription).toMatchObject({ provider: 'preview-fixture', planKind: 'paid', status: 'active' })
    const balance = await ctx.db.query('billingAccountBalances')
      .withIndex('by_billingAccountId', q => q.eq('billingAccountId', billingAccountId)).unique()
    expect(balance?.includedMicros).toBe(5_000_000)
    await ctx.db.patch(balance!._id, { allowanceUsedMicros: 4_000_000 })
  })
  expect(await t.mutation(grant, { serverSecret: secret, workspaceId: 'ws-qa' })).toEqual({ granted: false })
  await t.run(async ctx => {
    const balance = await ctx.db.query('billingAccountBalances')
      .withIndex('by_billingAccountId', q => q.eq('billingAccountId', billingAccountId)).unique()
    expect(balance).toMatchObject({ includedMicros: 5_000_000, allowanceUsedMicros: 4_000_000 })
  })
  await expect(t.mutation(grant, { serverSecret: secret, workspaceId: 'ws-missing' })).rejects.toThrow('WORKSPACE_WALLET_MISSING')
})
