import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const previous = {
  enabled: process.env.OVERLAY_FEATURE_WORKSPACE_WALLETS,
  stage: process.env.OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE,
}
beforeAll(() => {
  process.env.OVERLAY_FEATURE_WORKSPACE_WALLETS = 'true'
  process.env.OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE = 'general'
})
afterAll(() => {
  if (previous.enabled === undefined) delete process.env.OVERLAY_FEATURE_WORKSPACE_WALLETS
  else process.env.OVERLAY_FEATURE_WORKSPACE_WALLETS = previous.enabled
  if (previous.stage === undefined) delete process.env.OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE
  else process.env.OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE = previous.stage
})

type Convex = ReturnType<typeof convexTest>

async function workspaceWith(convex: Convex, kind: 'personal' | 'organization', plan: 'paid' | 'free' | null) {
  const workspaceId = `ws-${kind}-${plan ?? 'none'}`
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId, kind, name: 'W', slug: workspaceId, status: 'active', createdAt: 1, updatedAt: 1 })
    if (plan === null) return
    await ctx.db.insert('billingAccounts', {
      billingAccountId: `ba-${workspaceId}`, scope: 'workspace', workspaceId, status: 'active', pricingVersion: 'markup_25_v1',
      markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('billingAccountSubscriptions', {
      billingAccountId: `ba-${workspaceId}`, provider: 'stripe', planKind: plan, planVersion: 'variable_v2',
      planAmountCents: plan === 'paid' ? 800 : 0, markupBasisPoints: 2_500, status: 'active',
      autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: 1, updatedAt: 1,
    })
  })
  return workspaceId
}

const payer = (convex: Convex, workspaceId: string) =>
  convex.query(internal.knowledge.knowledge.resolveKnowledgeBillingPayer, { userId: 'user-1', workspaceId })

describe('knowledge billing payer', () => {
  test('a workspace on a paid plan pays, whatever kind of workspace it is', async () => {
    const convex = convexTest(schema, modules)
    for (const kind of ['organization', 'personal'] as const) {
      const workspaceId = await workspaceWith(convex, kind, 'paid')
      expect(await payer(convex, workspaceId)).toEqual({ billingAccountId: `ba-${workspaceId}`, scope: 'workspace', workspaceId })
    }
  })

  test('a workspace with no wallet, or a wallet that is not on a paid plan, is on the free allowance', async () => {
    const convex = convexTest(schema, modules)
    expect(await payer(convex, await workspaceWith(convex, 'organization', null))).toEqual({ scope: 'personal' })
    expect(await payer(convex, await workspaceWith(convex, 'personal', 'free'))).toEqual({ scope: 'personal' })
  })
})
