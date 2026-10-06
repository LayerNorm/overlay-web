import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
const secret = 'plan-conversion-secret'
const previous = {
  enabled: process.env.OVERLAY_FEATURE_WORKSPACE_WALLETS,
  stage: process.env.OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE,
  selected: process.env.OVERLAY_WORKSPACE_BILLING_SELECTED_WORKSPACE_IDS,
}
beforeAll(() => {
  process.env.INTERNAL_API_SECRET = secret
  process.env.OVERLAY_FEATURE_WORKSPACE_WALLETS = 'true'
  process.env.OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE = 'selected'
  process.env.OVERLAY_WORKSPACE_BILLING_SELECTED_WORKSPACE_IDS = 'ws-1'
})
afterAll(() => {
  for (const [key, value] of [
    ['OVERLAY_FEATURE_WORKSPACE_WALLETS', previous.enabled],
    ['OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE', previous.stage],
    ['OVERLAY_WORKSPACE_BILLING_SELECTED_WORKSPACE_IDS', previous.selected],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

type Convex = ReturnType<typeof convexTest>
const mutationRef = (name: string) => makeFunctionReference<'mutation'>(name)
const queryRef = (name: string) => makeFunctionReference<'query'>(name)
const initializeUsage = mutationRef('platform/usage:initializeSubscriptionUsageByServer')
const legacyTopUp = mutationRef('billing/subscriptions:recordBudgetTopUpByServer')
const personalEntitlements = queryRef('platform/usage:getEntitlementsByServer')
const accountEntitlements = queryRef('billing/accountSubscriptions:getEntitlementsByServer')

const MICROS = 10_000
const week = 7 * 24 * 60 * 60_000

/** user-1 pays $20/month for a personal plan with a $8 top-up, has used $5, and owns workspace ws-1. */
async function seed(convex: Convex, overrides: { owner?: boolean; autoTopUp?: boolean; plan?: 'paid' | 'free' } = {}) {
  await convex.mutation(initializeUsage, { serverSecret: secret, userId: 'user-1' })
  await convex.run(async (ctx) => {
    const subscription = await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', 'user-1')).unique()
    const paid = (overrides.plan ?? 'paid') === 'paid'
    await ctx.db.patch(subscription!._id, {
      tier: paid ? 'pro' : 'free', planKind: paid ? 'paid' : 'free', planAmountCents: paid ? 2_000 : 0, status: 'active',
      ...(paid ? { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_1', stripeQuantity: 20 } : {}),
      autoTopUpEnabled: overrides.autoTopUp ?? false, creditsUsed: 500, allowanceUsedCents: 500,
      currentPeriodStart: Date.now() - week, currentPeriodEnd: Date.now() + 3 * week,
      overlayStorageBytesUsed: 5_000,
    })
    await ctx.db.insert('workspaces', { workspaceId: 'ws-1', kind: 'personal', name: 'W', slug: 'ws-1', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspacePrincipals', { principalId: 'p-1', workspaceId: 'ws-1', type: 'human', userId: 'user-1', displayName: 'U', createdAt: 1, updatedAt: 1 } as never)
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'm-1', workspaceId: 'ws-1', principalId: 'p-1', role: overrides.owner === false ? 'member' : 'owner', status: 'active', joinedAt: 1, updatedAt: 1,
    })
  })
  await convex.mutation(legacyTopUp, { serverSecret: secret, userId: 'user-1', amountCents: 800, source: 'manual', status: 'succeeded', stripeCheckoutSessionId: 'cs_1' })
}

const preview = (convex: Convex) => convex.query(internal.billing.planConversion.previewPlanConversion, { userId: 'user-1', workspaceId: 'ws-1' })
const convert = (convex: Convex) => convex.mutation(internal.billing.planConversion.convertPlanToWorkspace, { userId: 'user-1', workspaceId: 'ws-1' })
const revert = (convex: Convex) => convex.mutation(internal.billing.planConversion.revertPlanConversion, { workspaceId: 'ws-1' })

const accounts = (convex: Convex) => convex.run(async (ctx) => (await ctx.db.query('billingAccounts').collect()).map((row) => ({
  id: row.billingAccountId, scope: row.scope, userId: row.userId, workspaceId: row.workspaceId,
})))

const fresh = () => convexTest(schema, modules)

const balance = (convex: Convex, billingAccountId: string) => convex.run(async (ctx) => {
  const row = await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId)).unique()
  return row ? { used: row.usedMicros / MICROS, topUp: row.topUpBalanceMicros / MICROS, included: row.includedMicros / MICROS } : null
})

describe('previewing a plan conversion', () => {
  test('a paying owner of the workspace can convert, and the preview says what happens without changing anything', async () => {
    const convex = fresh()
    await seed(convex)
    const before = await accounts(convex)
    const result = await preview(convex)
    expect(result.blockers).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.plan).toMatchObject({ amountCents: 2_000, stripeSubscriptionId: 'sub_1' })
    expect(result.balance).toMatchObject({ usedCents: 500, topUpBalanceCents: 800 })
    expect(result.effects.join(' ')).toMatch(/Free/)
    expect(await accounts(convex)).toEqual(before)
  })

  test.each([
    ['someone who does not own the workspace', { owner: false }, 'person_is_not_the_workspace_owner'],
    ['auto top-up being on', { autoTopUp: true }, 'auto_top_up_is_on_turn_it_off_first'],
    ['a personal plan that is not paid', { plan: 'free' as const }, 'personal_plan_is_not_paid'],
  ])('is blocked by %s', async (_label, overrides, blocker) => {
    const convex = fresh()
    await seed(convex, overrides)
    const result = await preview(convex)
    expect(result.ok).toBe(false)
    expect(result.blockers).toContain(blocker)
  })

  test('is blocked when workspace billing is not enabled for the workspace, so the person cannot lose the plan they paid for', async () => {
    const convex = fresh()
    await seed(convex)
    process.env.OVERLAY_WORKSPACE_BILLING_SELECTED_WORKSPACE_IDS = 'someone-else'
    try {
      expect((await preview(convex)).blockers).toContain('workspace_billing_is_not_enabled_for_this_workspace')
    } finally {
      process.env.OVERLAY_WORKSPACE_BILLING_SELECTED_WORKSPACE_IDS = 'ws-1'
    }
  })

  test('is blocked while usage is in flight', async () => {
    const convex = fresh()
    await seed(convex)
    await convex.run(async (ctx) => {
      const account = await ctx.db.query('billingAccounts').first()
      await ctx.db.insert('budgetReservations', {
        userId: 'user-1', billingAccountId: account!.billingAccountId, reservationId: 'r1', status: 'reserved', kind: 'ask', modelId: 'm',
        operationId: 'o1', reservedCents: 50, createdAt: 1, updatedAt: 1,
      } as never)
    })
    expect((await preview(convex)).blockers).toContain('usage_is_in_flight_try_again_shortly')
  })
})

describe('converting a plan onto a workspace', () => {
  test('the plan, balance, and Stripe subscription become the workspace’s; the person becomes free with a fresh account', async () => {
    const convex = fresh()
    await seed(convex)
    const original = (await accounts(convex))[0]!
    const before = await balance(convex, original.id)
    const result = await convert(convex)

    expect(result.billingAccountId).toBe(original.id)
    const after = await accounts(convex)
    expect(after.find((row) => row.id === original.id)).toEqual({ id: original.id, scope: 'workspace', userId: undefined, workspaceId: 'ws-1' })
    expect(after.filter((row) => row.scope === 'personal')).toHaveLength(1)
    expect(after.find((row) => row.scope === 'personal')).toMatchObject({ userId: 'user-1', id: result.personalBillingAccountId })

    // The workspace account carries exactly what the person had.
    expect(await balance(convex, original.id)).toEqual(before)
    const wallet = await convex.query(accountEntitlements, { serverSecret: secret, billingAccountId: original.id })
    expect(wallet).toMatchObject({ planKind: 'paid', tier: 'pro' })
    const planRow = await convex.run(async (ctx) => await ctx.db.query('billingAccountSubscriptions').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', original.id)).unique())
    expect(planRow).toMatchObject({ providerSubscriptionId: 'sub_1', providerCustomerId: 'cus_1', planKind: 'paid', planAmountCents: 2_000 })

    // The person themselves is on the free plan with nothing of the old plan left on their row.
    const personal = await convex.query(personalEntitlements, { serverSecret: secret, userId: 'user-1' })
    expect(personal).toMatchObject({ planKind: 'free', tier: 'free' })
    const row = await convex.run(async (ctx) => await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', 'user-1')).unique())
    expect(row).toMatchObject({ planKind: 'free', billingAccountId: result.personalBillingAccountId, creditsUsed: 0, topUpBalanceCents: 0 })
    expect(row?.stripeSubscriptionId).toBeUndefined()
    // Their storage meter is untouched.
    expect(row?.overlayStorageBytesUsed).toBe(5_000)
  })

  test('after the move a teammate can spend from the workspace plan, and the pool is what is left', async () => {
    const convex = fresh()
    await seed(convex)
    const original = (await accounts(convex))[0]!
    await convert(convex)
    const reserved = await convex.mutation(mutationRef('platform/usage:reserveWorkspaceBudgetByServer'), {
      serverSecret: secret, billingAccountId: original.id, workspaceId: 'ws-1', userId: 'teammate', spendSubjectKind: 'member', spendSubjectId: 'teammate',
      kind: 'ask', modelId: 'm', operationId: 'op-1', requestFingerprint: 'fp', reservationId: 'res-1', reservedCents: 300,
    })
    // $20 plan + $8 top-up - $5 used = $23 left before this hold; $3 held now.
    expect(reserved).toMatchObject({ status: 'reserved', budgetUsedCents: 500 })
    const remaining = await convex.query(accountEntitlements, { serverSecret: secret, billingAccountId: original.id })
    expect(remaining.budgetRemainingCents).toBe(2_000)
  })

  test('later billing changes for the person never touch the workspace account', async () => {
    const convex = fresh()
    await seed(convex)
    const original = (await accounts(convex))[0]!
    await convert(convex)
    const before = await balance(convex, original.id)
    await convex.mutation(initializeUsage, { serverSecret: secret, userId: 'user-1' })
    expect(await balance(convex, original.id)).toEqual(before)
  })

  test('a second conversion for the same person is refused, and a refused conversion changes nothing', async () => {
    const convex = fresh()
    await seed(convex, { autoTopUp: true })
    const before = await accounts(convex)
    await expect(convert(convex)).rejects.toThrow(/plan_conversion_blocked:auto_top_up_is_on/)
    expect(await accounts(convex)).toEqual(before)

    const other = fresh()
    await seed(other)
    await convert(other)
    await expect(convert(other)).rejects.toThrow(/plan_conversion_blocked/)
  })

  test('Stripe events for the subscription route to the workspace account after, and not before', async () => {
    const convex = fresh()
    await seed(convex)
    const route = () => convex.query(internal.billing.planConversion.resolveWorkspaceAccountByProviderReference, { stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })
    expect(await route()).toBeNull()
    const result = await convert(convex)
    expect(await route()).toBe(result.billingAccountId)
    expect(await convex.query(internal.billing.planConversion.resolveWorkspaceAccountByProviderReference, { stripeSubscriptionId: 'sub_other' })).toBeNull()
  })
})

describe('reverting a plan conversion', () => {
  test('hands the account back with the credits the workspace used and the balance it has now', async () => {
    const convex = fresh()
    await seed(convex)
    const original = (await accounts(convex))[0]!
    await convert(convex)
    // The workspace spends another $3 and the plan renews its period.
    await convex.run(async (ctx) => {
      const row = await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', original.id)).unique()
      await ctx.db.patch(row!._id, { usedMicros: row!.usedMicros + 300 * MICROS, allowanceUsedMicros: row!.allowanceUsedMicros + 300 * MICROS })
    })
    await revert(convex)

    const after = await accounts(convex)
    expect(after).toEqual([{ id: original.id, scope: 'personal', userId: 'user-1', workspaceId: undefined }])
    const entitlements = await convex.query(personalEntitlements, { serverSecret: secret, userId: 'user-1' })
    expect(entitlements).toMatchObject({ planKind: 'paid', tier: 'pro', budgetUsedCents: 800 })
    const row = await convex.run(async (ctx) => await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', 'user-1')).unique())
    expect(row).toMatchObject({ stripeSubscriptionId: 'sub_1', creditsUsed: 800, billingAccountId: original.id })
    // It can be converted again.
    expect((await preview(convex)).ok).toBe(true)
  })

  test('is refused with nothing to revert, or once the person has started using their new personal account', async () => {
    const convex = fresh()
    await seed(convex)
    await expect(revert(convex)).rejects.toThrow(/no_plan_conversion_to_revert/)
    await convert(convex)
    await convex.run(async (ctx) => {
      const row = await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', 'user-1')).unique()
      await ctx.db.patch(row!._id, { creditsUsed: 10 })
    })
    await expect(revert(convex)).rejects.toThrow(/personal_account_in_use/)
  })
})
