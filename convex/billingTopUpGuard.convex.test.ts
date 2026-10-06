import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { syncPersonalBillingShadows } from './billing/accountMigration'

const modules = import.meta.glob('./**/*.ts')
const secret = 'top-up-guard-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

type Convex = ReturnType<typeof convexTest>
const ref = (name: string) => makeFunctionReference<'mutation'>(name)
const canonicalTopUp = ref('billing/accountSubscriptions:recordTopUpByServer')
const legacyTopUp = ref('billing/subscriptions:recordBudgetTopUpByServer')
const initializeUsage = ref('platform/usage:initializeSubscriptionUsageByServer')

const MICROS = 10_000

/** A paying person (legacy subscription row, as every personal account has) with their personal billing account. */
async function paidPerson(convex: Convex, userId = 'user-1') {
  await convex.mutation(initializeUsage, { serverSecret: secret, userId })
  return await convex.run(async (ctx) => {
    const subscription = await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', userId)).unique()
    await ctx.db.patch(subscription!._id, {
      tier: 'pro', planKind: 'paid', planAmountCents: 2_000, status: 'active', creditsUsed: 0,
      currentPeriodStart: Date.now() - 1_000, currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60_000,
    })
    const account = await ctx.db.query('billingAccounts').withIndex('by_userId', (q) => q.eq('userId', userId)).unique()
    return account!.billingAccountId
  })
}

const balance = (convex: Convex, billingAccountId: string) => convex.run(async (ctx) => {
  const row = await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId)).unique()
  return { purchased: row!.topUpPurchasedMicros / MICROS, available: row!.topUpBalanceMicros / MICROS }
})

describe('top-ups on a personal account', () => {
  test('an account-level top-up is refused instead of being granted and then silently reverted', async () => {
    const convex = convexTest(schema, modules)
    const account = await paidPerson(convex)
    await expect(convex.mutation(canonicalTopUp, {
      serverSecret: secret, actorUserId: 'user-1', amountCents: 800, billingAccountId: account, source: 'manual', status: 'succeeded',
      stripeCheckoutSessionId: 'cs_1',
    })).rejects.toThrow(/billing_account_balance_is_legacy_synced/)
    expect(await balance(convex, account)).toEqual({ purchased: 0, available: 0 })
    expect(await convex.run(async (ctx) => (await ctx.db.query('budgetTopUps').collect()).length)).toBe(0)
  })

  test('the personal top-up is granted and survives later billing changes', async () => {
    const convex = convexTest(schema, modules)
    const account = await paidPerson(convex)
    await convex.mutation(legacyTopUp, { serverSecret: secret, userId: 'user-1', amountCents: 800, source: 'manual', status: 'succeeded', stripeCheckoutSessionId: 'cs_1' })
    expect(await balance(convex, account)).toEqual({ purchased: 800, available: 800 })
    // Any later billing change re-syncs the account-keyed copy from the person's row; the top-up must still be there.
    await convex.mutation(initializeUsage, { serverSecret: secret, userId: 'user-1' })
    expect(await balance(convex, account)).toEqual({ purchased: 800, available: 800 })
  })
})

describe('workspace accounts', () => {
  async function workspaceWallet(convex: Convex) {
    return await convex.run(async (ctx) => {
      await ctx.db.insert('billingAccounts', {
        billingAccountId: 'ba-ws', scope: 'workspace', workspaceId: 'ws-1', status: 'active', pricingVersion: 'markup_25_v1',
        markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('billingAccountBalances', {
        billingAccountId: 'ba-ws', mode: 'budgeted', includedMicros: 0, institutionalGrantMicros: 0, allowanceUsedMicros: 0,
        topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 0, version: 1, createdAt: 1, updatedAt: 1,
      })
      return 'ba-ws'
    })
  }

  test('an account-level top-up works and is not touched by a personal account syncing', async () => {
    const convex = convexTest(schema, modules)
    const personal = await paidPerson(convex)
    const wallet = await workspaceWallet(convex)
    await convex.mutation(canonicalTopUp, {
      serverSecret: secret, actorUserId: 'user-1', amountCents: 800, billingAccountId: wallet, source: 'manual', status: 'succeeded', stripeCheckoutSessionId: 'cs_ws',
    })
    await convex.mutation(initializeUsage, { serverSecret: secret, userId: 'user-1' })
    expect(await balance(convex, wallet)).toEqual({ purchased: 800, available: 800 })
    expect(await balance(convex, personal)).toEqual({ purchased: 0, available: 0 })
  })

  test('the personal-account sync refuses to overwrite a workspace account', async () => {
    const convex = convexTest(schema, modules)
    await paidPerson(convex)
    const wallet = await workspaceWallet(convex)
    await expect(convex.run(async (ctx) => await syncPersonalBillingShadows(ctx, 'user-1', wallet)))
      .rejects.toThrow(/billing_shadow_sync_on_non_personal_account/)
  })
})
