import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { api, internal } from './_generated/api'
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
    stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', currentPeriodStart: 1_000, currentPeriodEnd: 2_000_000_000_000,
  })
  await convex.mutation(api.billing.accountSubscriptions.fundPaidPeriodByServer, {
    billingAccountId: 'ba-1', serverSecret, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    paidInvoiceId: 'in_initial', paidPeriodStart: 1_000, paidPeriodEnd: 2_000_000_000_000, amountCents: 800,
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

  test('claims an account-level intent before Stripe and reserves its monthly allowance', async () => {
    const convex = convexTest(schema, modules)
    await paidWorkspace(convex)
    await convex.mutation(api.billing.accountSubscriptions.upsertByServer, {
      billingAccountId: 'ba-1', serverSecret, autoTopUpEnabled: true, autoTopUpAmountCents: 800,
      autoTopUpMonthlyLimitCents: 800, offSessionConsentAt: 5,
    })
    const args = {
      actorUserId: 'user-1',
      billingAccountId: 'ba-1',
      workspaceId: 'ws-1',
      intentKey: 'intent_a',
      idempotencyKey: 'workspace-auto-topup-intent_a',
      amountCents: 800,
      currentPeriodStart: 1_000,
      consentAt: 5,
      paymentMethodId: 'pm_1',
      customerId: 'cus_1',
      serverSecret,
    }
    const [first, duplicate] = await Promise.all([
      convex.mutation(api.billing.accountSubscriptions.claimAutoTopUpIntentByServer, args),
      convex.mutation(api.billing.accountSubscriptions.claimAutoTopUpIntentByServer, args),
    ])
    expect(first).toEqual({ status: 'claimed', idempotencyKey: args.idempotencyKey })
    expect(duplicate).toEqual(first)
    expect(await convex.run((ctx) => ctx.db.query('billingAutoTopUpIntents').collect())).toHaveLength(1)

    expect(await convex.mutation(api.billing.accountSubscriptions.claimAutoTopUpIntentByServer, {
      ...args, intentKey: 'intent_b', idempotencyKey: 'workspace-auto-topup-intent_b',
    })).toEqual({ status: 'monthly_limit_reached' })
  })

  test('a declined claim stays latched across period rollover until its payment authorization changes', async () => {
    const convex = convexTest(schema, modules)
    await paidWorkspace(convex)
    await convex.mutation(api.billing.accountSubscriptions.upsertByServer, {
      billingAccountId: 'ba-1', serverSecret, autoTopUpEnabled: true, autoTopUpAmountCents: 800,
      autoTopUpMonthlyLimitCents: 2_400, offSessionConsentAt: 5,
    })
    const args = {
      actorUserId: 'user-1', billingAccountId: 'ba-1', workspaceId: 'ws-1',
      intentKey: 'intent_failed', idempotencyKey: 'workspace-auto-topup-intent_failed',
      amountCents: 800, currentPeriodStart: 1_000, consentAt: 5,
      paymentMethodId: 'pm_1', customerId: 'cus_1', serverSecret,
    }
    await convex.mutation(api.billing.accountSubscriptions.claimAutoTopUpIntentByServer, args)
    await convex.run(async (ctx) => {
      const claim = await ctx.db.query('billingAutoTopUpIntents')
        .withIndex('by_billingAccountId_intentKey', q => q.eq('billingAccountId', 'ba-1').eq('intentKey', args.intentKey))
        .unique()
      if (!claim) throw new Error('claim_missing')
      await ctx.db.patch(claim._id, { state: 'payment_failed' })
    })
    expect(await convex.mutation(api.billing.accountSubscriptions.claimAutoTopUpIntentByServer, {
      ...args, intentKey: 'intent_next_period', idempotencyKey: 'workspace-auto-topup-intent_next_period',
      currentPeriodStart: 2_000,
    })).toEqual({ status: 'payment_failed' })
    expect(await convex.mutation(api.billing.accountSubscriptions.claimAutoTopUpIntentByServer, {
      ...args, intentKey: 'intent_repaired', idempotencyKey: 'workspace-auto-topup-intent_repaired',
      currentPeriodStart: 2_000, paymentMethodId: 'pm_repaired',
    })).toEqual({ status: 'claimed', idempotencyKey: 'workspace-auto-topup-intent_repaired' })
  })

  test('a pending top-up is credited once when Stripe settles it, and a failed one is not', async () => {
    const convex = convexTest(schema, modules)
    await paidWorkspace(convex)
    for (const id of ['pi_ok', 'pi_bad']) {
      await convex.mutation(api.billing.accountSubscriptions.recordTopUpByServer, {
        actorUserId: 'user-1', amountCents: 800, billingAccountId: 'ba-1', source: 'auto', status: 'pending', serverSecret,
        stripePaymentIntentId: id,
      })
    }
    const before = await convex.query(api.billing.accountSubscriptions.getByServer, { billingAccountId: 'ba-1', serverSecret })
    expect(before?.autoTopUpPending).toBe(true)
    const balance = () => convex.run(async (ctx) => (await ctx.db.query('billingAccountBalances').collect())[0]?.topUpBalanceMicros)
    const startMicros = await balance()

    const settle = (id: string, outcome: 'succeeded' | 'failed') =>
      convex.mutation(internal.billing.autoTopUpSettlement.settlePendingTopUpInternal, { stripePaymentIntentId: id, outcome })
    expect(await settle('pi_ok', 'succeeded')).toEqual({ settled: true, granted: true })
    expect(await settle('pi_ok', 'succeeded')).toEqual({ settled: false, granted: false })
    expect(await settle('pi_bad', 'failed')).toEqual({ settled: true, granted: false })
    expect(await balance()).toBe((startMicros ?? 0) + 800 * 10_000)

    const after = await convex.query(api.billing.accountSubscriptions.getByServer, { billingAccountId: 'ba-1', serverSecret })
    expect(after?.autoTopUpPending).toBe(false)
    expect(after?.autoTopUpSpentThisPeriodCents).toBe(800)
  })

  test('a claimed top-up settlement is idempotent and closes its intent', async () => {
    const convex = convexTest(schema, modules)
    await paidWorkspace(convex)
    await convex.mutation(api.billing.accountSubscriptions.upsertByServer, {
      billingAccountId: 'ba-1', serverSecret, autoTopUpEnabled: true, autoTopUpAmountCents: 800,
      autoTopUpMonthlyLimitCents: 1_600, offSessionConsentAt: 5,
    })
    const claimArgs = {
      actorUserId: 'user-1', billingAccountId: 'ba-1', workspaceId: 'ws-1',
      intentKey: 'intent_settlement', idempotencyKey: 'workspace-auto-topup-intent_settlement',
      amountCents: 800, currentPeriodStart: 1_000, consentAt: 5,
      paymentMethodId: 'pm_1', customerId: 'cus_1', serverSecret,
    }
    await convex.mutation(api.billing.accountSubscriptions.claimAutoTopUpIntentByServer, claimArgs)
    await convex.mutation(api.billing.accountSubscriptions.recordTopUpByServer, {
      actorUserId: 'user-1', amountCents: 800, billingAccountId: 'ba-1', source: 'auto', status: 'pending',
      stripePaymentIntentId: 'pi_claimed', autoTopUpIntentKey: claimArgs.intentKey, serverSecret,
    })
    const settle = () => convex.mutation(internal.billing.autoTopUpSettlement.settlePendingTopUpInternal, {
      stripePaymentIntentId: 'pi_claimed', outcome: 'succeeded',
    })
    expect(await settle()).toEqual({ settled: true, granted: true })
    expect(await settle()).toEqual({ settled: false, granted: false })
    expect(await convex.run((ctx) => ctx.db.query('billingAutoTopUpIntents').collect()))
      .toMatchObject([{ state: 'succeeded', stripePaymentIntentId: 'pi_claimed' }])
  })

  test('credit does not carry over: the plan credit and any top-up balance reset at renewal', async () => {
    const convex = convexTest(schema, modules)
    await paidWorkspace(convex)
    await convex.mutation(api.billing.accountSubscriptions.recordTopUpByServer, {
      actorUserId: 'user-1', amountCents: 2_000, billingAccountId: 'ba-1', source: 'manual', status: 'succeeded', serverSecret,
      stripePaymentIntentId: 'pi_manual',
    })
    const balance = () => convex.run(async (ctx) => (await ctx.db.query('billingAccountBalances').collect())[0])
    expect((await balance())?.topUpBalanceMicros).toBe(2_000 * 10_000)
    // Lifecycle metadata alone cannot expire or grant money.
    const nextPeriodStart = 1_000 + 31 * 24 * 60 * 60 * 1000
    const nextPeriodEnd = 2_000_000_000_000 + 31 * 24 * 60 * 60 * 1000
    await convex.mutation(api.billing.accountSubscriptions.upsertByServer, {
      billingAccountId: 'ba-1', serverSecret, currentPeriodStart: nextPeriodStart, currentPeriodEnd: nextPeriodEnd,
    })
    expect((await balance())?.topUpBalanceMicros).toBe(2_000 * 10_000)
    await convex.mutation(api.billing.accountSubscriptions.fundPaidPeriodByServer, {
      billingAccountId: 'ba-1', serverSecret, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
      paidInvoiceId: 'in_renewal', paidPeriodStart: nextPeriodStart, paidPeriodEnd: nextPeriodEnd, amountCents: 800,
    })
    const after = await balance()
    expect(after?.topUpBalanceMicros).toBe(0)
    expect(after?.topUpPurchasedMicros).toBe(0)
    expect(after?.usedMicros).toBe(0)
    expect(after?.includedMicros).toBe(800 * 10_000)
  })
})
