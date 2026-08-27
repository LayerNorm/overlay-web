import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const serverSecret = 'billing-account-migration-test-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = serverSecret })

describe('personal billing-account migration', () => {
  test('ignores completed reservation history when calculating the active balance', async () => {
    const convex = convexTest(schema, modules)
    const userId = 'high-volume-user'
    const billingAccountId = 'ba_high_volume'
    await convex.run(async (ctx) => {
      const now = Date.now()
      await ctx.db.insert('billingAccounts', {
        billingAccountId,
        createdAt: now,
        markupBasisPoints: 2_500,
        pricingVersion: 'markup_25_v1',
        scope: 'personal',
        status: 'active',
        updatedAt: now,
        userId,
      })
      await ctx.db.insert('billingAccountBalances', {
        allowanceUsedMicros: 0,
        billingAccountId,
        createdAt: now,
        includedMicros: 0,
        institutionalGrantMicros: 0,
        mode: 'budgeted',
        reservedMicros: 0,
        topUpBalanceMicros: 0,
        topUpPurchasedMicros: 0,
        updatedAt: now,
        usedMicros: 0,
        version: 0,
      })
      await ctx.db.insert('subscriptions', {
        billingAccountId,
        status: 'active',
        tier: 'free',
        userId,
      })
      for (let index = 0; index < 1_001; index += 1) {
        await ctx.db.insert('budgetReservations', {
          billingAccountId,
          createdAt: index,
          kind: 'ask',
          reservationId: `completed-${index}`,
          reservedCents: 1,
          status: 'finalized',
          updatedAt: index,
          userId,
        })
      }
      await ctx.db.insert('budgetReservations', {
        billingAccountId,
        createdAt: now,
        kind: 'agent',
        reservationId: 'needs-reconciliation',
        reservedCents: 7,
        status: 'reconcile_required',
        updatedAt: now,
        userId,
      })
    })

    const result = await convex.mutation(
      makeFunctionReference<'mutation'>('billing/accountMigration:backfillPersonalByUserByServer'),
      { serverSecret, userId },
    )
    expect(result.complete).toBe(true)
    const balance = await convex.run(async (ctx) => ctx.db.query('billingAccountBalances')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
      .unique())
    expect(balance?.reservedMicros).toBe(70_000)
  })
})
