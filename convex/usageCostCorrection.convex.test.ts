import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'cost-correction-test-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
const correct = makeFunctionReference<'mutation'>('platform/usage:correctFinalizedBudgetReservationCostByServer')

/** A finalized 10-cent estimate that was charged entirely to the allowance. */
async function fixture({ included = 20_000_000, allowanceUsed = 100_000, topUp = 0, status = 'finalized' as 'finalized' | 'reserved' } = {}) {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba', scope: 'workspace', workspaceId: 'ws',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('billingAccountBalances', { billingAccountId: 'ba', mode: 'budgeted', includedMicros: included,
      institutionalGrantMicros: 0, allowanceUsedMicros: allowanceUsed, topUpPurchasedMicros: topUp, topUpBalanceMicros: topUp,
      usedMicros: allowanceUsed, reservedMicros: 0, version: 1, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('billingAccountSpendLimits', { billingAccountId: 'ba', subjectKind: 'member', subjectId: 'user',
      limitMicros: 100_000_000, usedMicros: allowanceUsed, reservedMicros: 0, periodStart: 0, periodEnd: Number.MAX_SAFE_INTEGER, version: 1, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('budgetReservations', { userId: 'user', billingAccountId: 'ba', spendSubjectKind: 'member', spendSubjectId: 'user',
      reservationId: 'hold', status, kind: 'agent', reservedCents: 50, finalizedCents: 10, createdAt: 1, updatedAt: 1 })
  })
  return t
}
const state = (t: ReturnType<typeof convexTest>) => t.run(async ctx => ({
  balance: await ctx.db.query('billingAccountBalances').first(),
  limit: await ctx.db.query('billingAccountSpendLimits').first(),
  reservation: await ctx.db.query('budgetReservations').first(),
}))
const run = (t: ReturnType<typeof convexTest>, actualCents: number, extra: Record<string, unknown> = {}) =>
  t.mutation(correct, { serverSecret: secret, userId: 'user', reservationId: 'hold', actualCents, providerCostUsd: actualCents / 125, ...extra })

test('an underestimate charges only the difference', async () => {
  const t = await fixture()
  expect(await run(t, 15)).toEqual({ status: 'corrected' })
  const { balance, limit, reservation } = await state(t)
  expect(balance).toMatchObject({ usedMicros: 150_000, allowanceUsedMicros: 150_000, reservedMicros: 0 })
  expect(limit).toMatchObject({ usedMicros: 150_000 })
  expect(reservation).toMatchObject({ estimatedCents: 10, finalizedCents: 15, status: 'finalized', providerCostMicros: 120_000 })
  expect(reservation?.costCorrectedAt).toBeTypeOf('number')
})

test('an overestimate refunds the difference to the allowance', async () => {
  const t = await fixture()
  await run(t, 4)
  const { balance, limit, reservation } = await state(t)
  expect(balance).toMatchObject({ usedMicros: 40_000, allowanceUsedMicros: 40_000 })
  expect(limit).toMatchObject({ usedMicros: 40_000 })
  expect(reservation).toMatchObject({ estimatedCents: 10, finalizedCents: 4 })
})

test('a refund larger than the allowance used returns the rest to top-ups', async () => {
  const t = await fixture({ allowanceUsed: 30_000, topUp: 5_000 })
  await t.run(async ctx => {
    const balance = await ctx.db.query('billingAccountBalances').first()
    await ctx.db.patch(balance!._id, { usedMicros: 100_000 })
  })
  await run(t, 0)
  expect((await state(t)).balance).toMatchObject({ usedMicros: 0, allowanceUsedMicros: 0, topUpBalanceMicros: 75_000 })
})

test('a retried correction moves money only once', async () => {
  const t = await fixture()
  await run(t, 15)
  const after = await state(t)
  expect(await run(t, 40)).toEqual({ status: 'already_corrected' })
  expect(await state(t)).toEqual(after)
})

test('a raise never charges more than the account holds, and records what it actually charged', async () => {
  const t = await fixture({ included: 120_000 })
  await run(t, 50)
  const { balance, reservation } = await state(t)
  expect(balance).toMatchObject({ usedMicros: 120_000, allowanceUsedMicros: 120_000 })
  expect(reservation).toMatchObject({ finalizedCents: 12 })
})

test('an unfinished hold is left alone', async () => {
  const t = await fixture({ status: 'reserved' })
  const before = await state(t)
  expect(await run(t, 15)).toEqual({ status: 'skipped' })
  expect(await state(t)).toEqual(before)
})

test('an upward correction preserves credit already reserved for other work', async () => {
  const t = await fixture({ included: 200_000 })
  await t.run(async ctx => {
    const balance = await ctx.db.query('billingAccountBalances').first()
    await ctx.db.patch(balance!._id, { reservedMicros: 80_000 })
  })
  await run(t, 50)
  const { balance, reservation } = await state(t)
  expect(balance).toMatchObject({ usedMicros: 120_000, reservedMicros: 80_000 })
  expect(reservation).toMatchObject({ finalizedCents: 12, providerCostMicros: 400_000 })
})

test('an upward correction respects the payer subject limit and its other holds', async () => {
  const t = await fixture()
  await t.run(async ctx => {
    const limit = await ctx.db.query('billingAccountSpendLimits').first()
    await ctx.db.patch(limit!._id, { limitMicros: 180_000, reservedMicros: 30_000 })
  })
  await run(t, 50)
  const { limit, reservation } = await state(t)
  expect(limit).toMatchObject({ usedMicros: 150_000, reservedMicros: 30_000 })
  expect(reservation).toMatchObject({ finalizedCents: 15, providerCostMicros: 400_000 })
})

test.each([4, 15])('a late %s-cent correction cannot change a renewed wallet', async actual => {
  const t = await fixture({ allowanceUsed: 0 })
  await t.run(async ctx => {
    await ctx.db.insert('billingAccountSubscriptions', {
      billingAccountId: 'ba', provider: 'stripe', planKind: 'paid', planVersion: 'variable_v2',
      planAmountCents: 800, markupBasisPoints: 2500, status: 'active', autoTopUpEnabled: false,
      autoTopUpAmountCents: 800, paidPeriodStart: Date.now() - 1_000,
      paidPeriodEnd: Date.now() + 86_400_000, createdAt: 1, updatedAt: 1,
    })
  })
  const before = await state(t)
  await run(t, actual)
  const after = await state(t)
  expect(after.balance).toEqual(before.balance)
  expect(after.limit).toEqual(before.limit)
  expect(after.reservation).toMatchObject({ finalizedCents: 10, providerCostMicros: actual * 8_000 })
})

test('a correction cannot debit a different spend-limit period', async () => {
  const t = await fixture()
  await t.run(async ctx => {
    const limit = await ctx.db.query('billingAccountSpendLimits').first()
    await ctx.db.patch(limit!._id, { periodStart: Date.now() - 1_000, usedMicros: 0 })
  })
  const before = await state(t)
  await run(t, 15)
  const after = await state(t)
  expect(after.balance).toEqual(before.balance)
  expect(after.limit).toEqual(before.limit)
  expect(after.reservation).toMatchObject({ finalizedCents: 10, providerCostMicros: 120_000 })
})

test('a refund leaves a different spend-limit period unchanged', async () => {
  const t = await fixture()
  await t.run(async ctx => {
    const limit = await ctx.db.query('billingAccountSpendLimits').first()
    await ctx.db.patch(limit!._id, { periodStart: Date.now() - 1_000, usedMicros: 50_000 })
  })
  const before = await state(t)
  await run(t, 4)
  const after = await state(t)
  expect(after.balance).toMatchObject({ usedMicros: 40_000, allowanceUsedMicros: 40_000 })
  expect(after.limit).toEqual(before.limit)
})

test('corrections need the server secret and the owning user', async () => {
  const t = await fixture()
  await expect(run(t, 15, { serverSecret: 'wrong' })).rejects.toThrow()
  await expect(run(t, 15, { userId: 'someone-else' })).rejects.toThrow('reservation_user_mismatch')
  expect((await state(t)).balance).toMatchObject({ usedMicros: 100_000 })
})
