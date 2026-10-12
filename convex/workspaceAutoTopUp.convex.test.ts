import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const previousSecret = process.env.INTERNAL_API_SECRET
beforeAll(() => { process.env.INTERNAL_API_SECRET = 'test-secret' })
afterAll(() => {
  if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousSecret
})

type Convex = ReturnType<typeof convexTest>
const serverSecret = 'test-secret'

async function paidWorkspace(convex: Convex) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('billingAccounts', {
      billingAccountId: 'ba-1', scope: 'workspace', workspaceId: 'ws-1', status: 'active', pricingVersion: 'markup_25_v1',
      markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
    })
  })
  await convex.mutation(api.billing.accountSubscriptions.upsertByServer, {
    billingAccountId: 'ba-1', serverSecret, planKind: 'paid', planAmountCents: 800, status: 'active',
    stripeCustomerId: 'cus_1', currentPeriodStart: 1_000, currentPeriodEnd: 2_000_000_000_000,
  })
}

describe('workspace automatic top-ups', () => {
  test('saves the monthly limit and reports what was charged this period', async () => {
    const convex = convexTest(schema, modules)
    await paidWorkspace(convex)
    await convex.mutation(api.billing.accountSubscriptions.upsertByServer, {
      billingAccountId: 'ba-1', serverSecret, autoTopUpEnabled: true, autoTopUpAmountCents: 800,
      autoTopUpMonthlyLimitCents: 2_400, offSessionConsentAt: 5,
    })
    for (const [status, source] of [['succeeded', 'auto'], ['pending', 'auto'], ['failed', 'auto'], ['succeeded', 'manual']] as const) {
      await convex.mutation(api.billing.accountSubscriptions.recordTopUpByServer, {
        actorUserId: 'user-1', amountCents: 800, billingAccountId: 'ba-1', source, status, serverSecret,
        stripePaymentIntentId: `pi_${status}_${source}`,
      })
    }
    const plan = await convex.query(api.billing.accountSubscriptions.getByServer, { billingAccountId: 'ba-1', serverSecret })
    expect(plan?.autoTopUpEnabled).toBe(true)
    expect(plan?.autoTopUpMonthlyLimitCents).toBe(2_400)
    // Succeeded and pending automatic top-ups count; failed ones and manual top-ups do not.
    expect(plan?.autoTopUpSpentThisPeriodCents).toBe(1_600)
  })

  test('turning top-ups off keeps the saved limit and stops them', async () => {
    const convex = convexTest(schema, modules)
    await paidWorkspace(convex)
    await convex.mutation(api.billing.accountSubscriptions.upsertByServer, {
      billingAccountId: 'ba-1', serverSecret, autoTopUpEnabled: true, autoTopUpAmountCents: 800, autoTopUpMonthlyLimitCents: 4_000,
    })
    await convex.mutation(api.billing.accountSubscriptions.upsertByServer, { billingAccountId: 'ba-1', serverSecret, autoTopUpEnabled: false })
    const plan = await convex.query(api.billing.accountSubscriptions.getByServer, { billingAccountId: 'ba-1', serverSecret })
    expect(plan?.autoTopUpEnabled).toBe(false)
    expect(plan?.autoTopUpMonthlyLimitCents).toBe(4_000)
  })
})
