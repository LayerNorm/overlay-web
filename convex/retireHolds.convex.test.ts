import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const MICROS_PER_CENT = 10_000

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba-ws', scope: 'workspace', workspaceId: 'ws-1',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba-personal', scope: 'personal', userId: 'user-1',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
    // Held: 10¢ + 5¢ by reservations and 20¢ by a stopped machine lease.
    await ctx.db.insert('billingAccountBalances', { billingAccountId: 'ba-ws', mode: 'budgeted', includedMicros: 20_000_000,
      institutionalGrantMicros: 0, allowanceUsedMicros: 1_000_000, topUpPurchasedMicros: 0, topUpBalanceMicros: 0,
      usedMicros: 1_000_000, reservedMicros: 35 * MICROS_PER_CENT, version: 1, createdAt: 1, updatedAt: 1 })
    const limitId = await ctx.db.insert('billingAccountSpendLimits', { billingAccountId: 'ba-ws', subjectKind: 'member',
      subjectId: 'user-1', limitMicros: 5_000_000, usedMicros: 1_000_000, reservedMicros: 30 * MICROS_PER_CENT,
      periodStart: 0, periodEnd: Number.MAX_SAFE_INTEGER, version: 1, createdAt: 1, updatedAt: 1 })
    const reservation = (reservationId: string, fields: Record<string, unknown>) => ctx.db.insert('budgetReservations', {
      userId: 'user-1', billingAccountId: 'ba-ws', spendSubjectKind: 'member', spendSubjectId: 'user-1', reservationId,
      kind: 'agent', status: 'reserved', reservedCents: 1, createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    await reservation('held', { reservedCents: 10 })
    await reservation('quarantined', { status: 'reconcile_required', reservedCents: 5, providerWorkStarted: true,
      spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a' })
    await reservation('settled', { status: 'finalized', reservedCents: 7, finalizedCents: 6 })
    await reservation('personal', { billingAccountId: 'ba-personal', spendSubjectKind: undefined, spendSubjectId: undefined,
      reservedCents: 3 })
    await ctx.db.insert('agentSandboxLeases', { leaseId: 'lease-1', workspaceId: 'ws-1', environmentId: 'env-1',
      provider: 'boat', status: 'released', reservedUntil: 1, cleanupAttempts: 0, createdAt: 1, updatedAt: 1,
      usage: { meteredAt: 1, runtimeHoldMicros: 20 * MICROS_PER_CENT, runtimeHoldLimits: [{ id: limitId, periodStart: 0 }],
        runtimeHoldPayer: { scope: 'workspace', workspaceId: 'ws-1', billingAccountId: 'ba-ws', userId: 'user-1' } } })
    await ctx.db.insert('agentSandboxLeases', { leaseId: 'lease-2', workspaceId: 'ws-1', environmentId: 'env-1',
      provider: 'boat', status: 'running', reservedUntil: 1, cleanupAttempts: 0, createdAt: 1, updatedAt: 1,
      usage: { meteredAt: 1, runtimeHoldMicros: 0 } })
  })
  return t
}

const state = (t: Awaited<ReturnType<typeof fixture>>) => t.run(async ctx => ({
  balance: await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', q => q.eq('billingAccountId', 'ba-ws')).unique(),
  limit: await ctx.db.query('billingAccountSpendLimits').first(),
  reservations: Object.fromEntries((await ctx.db.query('budgetReservations').collect())
    .map(row => [row.reservationId, { status: row.status, errorMessage: row.errorMessage }])),
  lease: (await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', q => q.eq('leaseId', 'lease-1')).unique())?.usage,
}))

test('the retirement migration releases every open hold without charging, and a rerun changes nothing', async () => {
  const t = await fixture()
  const reservations = await t.mutation(internal.billing.retireHolds.releaseRetiredHoldsInternal, { continue: false })
  expect(reservations).toEqual({ released: 3, releasedMicros: 15 * MICROS_PER_CENT, done: true })
  const leases = await t.mutation(internal.billing.retireHolds.releaseRetiredLeaseHoldsInternal, { continue: false })
  expect(leases).toEqual({ released: 1, releasedMicros: 20 * MICROS_PER_CENT, done: true })

  const after = await state(t)
  // All held money is available again; nothing was charged.
  expect(after.balance).toMatchObject({ reservedMicros: 0, usedMicros: 1_000_000, allowanceUsedMicros: 1_000_000 })
  // The member limit gives back the reservation (10¢) and the lease hold (20¢); the agent's hold had no limit row.
  expect(after.limit).toMatchObject({ reservedMicros: 0, usedMicros: 1_000_000 })
  expect(after.reservations).toEqual({
    held: { status: 'released', errorMessage: 'holds_retired' },
    quarantined: { status: 'released', errorMessage: 'holds_retired' },
    settled: { status: 'finalized', errorMessage: undefined },
    personal: { status: 'released', errorMessage: 'holds_retired' },
  })
  expect(after.lease).toMatchObject({ runtimeHoldMicros: 0, runtimeHoldPayer: null, runtimeHoldLimits: [] })

  expect(await t.mutation(internal.billing.retireHolds.releaseRetiredHoldsInternal, { continue: false }))
    .toEqual({ released: 0, releasedMicros: 0, done: true })
  expect(await t.mutation(internal.billing.retireHolds.releaseRetiredLeaseHoldsInternal, { continue: false }))
    .toEqual({ released: 0, releasedMicros: 0, done: true })
  expect(await state(t)).toEqual(after)
})

test('the migration works in bounded batches until no open hold is left', async () => {
  const t = await fixture()
  const first = await t.mutation(internal.billing.retireHolds.releaseRetiredHoldsInternal, { batchSize: 2, continue: false })
  expect(first).toMatchObject({ released: 2, done: false })
  const second = await t.mutation(internal.billing.retireHolds.releaseRetiredHoldsInternal, { batchSize: 2, continue: false })
  expect(second).toMatchObject({ released: 1, done: true })
  expect((await state(t)).balance?.reservedMicros).toBe(20 * MICROS_PER_CENT)
})

test('a held amount larger than the balance records never drives it below zero', async () => {
  const t = await fixture()
  await t.run(async ctx => {
    const balance = await ctx.db.query('billingAccountBalances').first()
    await ctx.db.patch(balance!._id, { reservedMicros: 4 * MICROS_PER_CENT })
  })
  await t.mutation(internal.billing.retireHolds.releaseRetiredHoldsInternal, { continue: false })
  await t.mutation(internal.billing.retireHolds.releaseRetiredLeaseHoldsInternal, { continue: false })
  expect((await state(t)).balance?.reservedMicros).toBe(0)
})
