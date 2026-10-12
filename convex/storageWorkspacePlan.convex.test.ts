import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import schema from './schema'
import { getStorageLimitForUser } from './files/lib/storageQuota'
import { FREE_PLAN_STORAGE_BYTES, getStorageLimitBytes } from '../src/shared/billing/billing-pricing'

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

/** A free person working in a workspace that has (or lacks) a plan of its own. */
async function setup(convex: Convex, plan: { kind: 'paid' | 'free'; cents: number } | null) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws-1', kind: 'personal', name: 'W', slug: 'ws-1', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceUserPreferences', { userId: 'user-1', activeWorkspaceId: 'ws-1', updatedAt: 1 })
    await ctx.db.insert('subscriptions', { userId: 'user-1', tier: 'free', status: 'active', creditsUsed: 0, overlayStorageBytesUsed: 0 })
    if (!plan) return
    await ctx.db.insert('billingAccounts', {
      billingAccountId: 'ba-1', scope: 'workspace', workspaceId: 'ws-1', status: 'active', pricingVersion: 'markup_25_v1',
      markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('billingAccountSubscriptions', {
      billingAccountId: 'ba-1', provider: 'stripe', planKind: plan.kind, planVersion: 'variable_v2', planAmountCents: plan.cents,
      markupBasisPoints: 2_500, status: 'active', autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: 1, updatedAt: 1,
    })
  })
}

const limit = (convex: Convex) => convex.run(async (ctx) => {
  const subscription = await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', 'user-1')).first()
  return await getStorageLimitForUser(ctx, 'user-1', subscription)
})

describe('storage limit follows the workspace plan', () => {
  test('a free person in a paid workspace gets the workspace plan’s storage', async () => {
    const convex = convexTest(schema, modules)
    await setup(convex, { kind: 'paid', cents: 2_000 })
    expect(await limit(convex)).toBe(getStorageLimitBytes({ planKind: 'paid', planAmountCents: 2_000 }))
  })

  test('a workspace without a paid plan leaves the person on their own limit', async () => {
    for (const plan of [null, { kind: 'free' as const, cents: 0 }]) {
      const convex = convexTest(schema, modules)
      await setup(convex, plan)
      expect(await limit(convex)).toBe(FREE_PLAN_STORAGE_BYTES)
    }
  })
})
