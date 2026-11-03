import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { WORKSPACE_AGENT_CREATURE_SHAPES } from '@overlay/workspace-contracts'
import schema from './schema'
import { workspaceExecutionAccess } from '@/shared/billing/execution-access'

const modules = import.meta.glob('./**/*.ts')
const seed = makeFunctionReference<'mutation'>('dev/fundingQa:init')
const recover = makeFunctionReference<'mutation'>('dev/qa:recover')
afterEach(() => vi.unstubAllEnvs())

test.each(['production', 'development', 'staging', ''])('funding fixtures reject %s without writes', async environment => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await expect(t.mutation(seed, { fixture: 'synthetic' })).rejects.toThrow('Preview seed is unavailable')
  expect(await t.run(ctx => ctx.db.query('billingAccounts').collect())).toEqual([])
})

test('fresh fixtures are isolated, inert and preserve funding, holds, grants and history on reseed', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_funding')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'funding@example.test')
  const t = convexTest(schema, modules)
  const original = await t.mutation(makeFunctionReference<'mutation'>('dev/seed:initQa'), {})
  const synthetic = await t.mutation(seed, { fixture: 'synthetic' })
  const stripe = await t.mutation(seed, { fixture: 'stripe-test' })
  expect(new Set([original.workspaceId, synthetic.workspaceId, stripe.workspaceId]).size).toBe(3)
  await t.run(async ctx => {
    const balances = await ctx.db.query('billingAccountBalances').collect()
    expect(balances).toHaveLength(3)
    expect(balances.find(row => ![synthetic.billingAccountId, stripe.billingAccountId].includes(row.billingAccountId))?.includedMicros).toBe(1_000_000)
    for (const fixture of [synthetic, stripe]) {
      const balance = balances.find(row => row.billingAccountId === fixture.billingAccountId)!
      expect(balance).toMatchObject({ includedMicros: 10_000, usedMicros: 0, reservedMicros: 0 })
      const plan = await ctx.db.query('billingAccountSubscriptions').withIndex('by_billingAccountId', q => q.eq('billingAccountId', fixture.billingAccountId)).unique()
      expect(plan).toMatchObject({ provider: 'preview-fixture', planKind: 'paid', autoTopUpEnabled: false })
      expect(workspaceExecutionAccess({ billingEnabled: true, accountStatus: 'active', subscription: plan, remainingCents: 1 }).canExecute).toBe(true)
      expect(plan?.providerCustomerId).toBeUndefined()
      expect(plan?.providerSubscriptionId).toBeUndefined()
      const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', fixture.agentId)).unique()
      expect(agent).toMatchObject({ allowedToolIds: [], createdByPrincipalId: `${fixture.workspaceId}-owner` })
      expect(WORKSPACE_AGENT_CREATURE_SHAPES).toContain(agent?.avatarShape)
      expect(agent?.avatarColor).toMatch(/^#[0-9a-f]{6}$/i)
      await ctx.db.patch(balance._id, { usedMicros: 5000, reservedMicros: 1000 })
    }
    expect(await ctx.db.query('harnessRuns').collect()).toEqual([])
    expect(await ctx.db.query('conversationAgentRuns').collect()).toEqual([])
  })
  await t.mutation(recover, { fixture: 'funding-workspace', availableCents: 100, requestId: 'funding-once' })
  const before = await t.run(ctx => ctx.db.query('billingAccountBalances').collect())
  expect(before.find(row => row.billingAccountId === synthetic.billingAccountId)).toMatchObject({ includedMicros: 1_006_000, usedMicros: 5000, reservedMicros: 1000 })
  expect(before.find(row => row.billingAccountId === stripe.billingAccountId)).toMatchObject({ includedMicros: 10_000, usedMicros: 5000, reservedMicros: 1000 })
  expect(await t.mutation(seed, { fixture: 'synthetic' })).toEqual(synthetic)
  expect(await t.mutation(seed, { fixture: 'stripe-test' })).toEqual(stripe)
  expect(await t.run(ctx => ctx.db.query('billingAccountBalances').collect())).toEqual(before)
  await t.run(async ctx => {
    const plan = await ctx.db.query('billingAccountSubscriptions').withIndex('by_billingAccountId', q => q.eq('billingAccountId', synthetic.billingAccountId)).unique()
    await ctx.db.patch(plan!._id, { providerCustomerId: 'cus_test_only' })
  })
  await expect(t.mutation(recover, { fixture: 'funding-workspace', availableCents: 100, requestId: 'no-mixed-funding' })).rejects.toThrow('synthetic active paid')
})
