import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const HOUR = 60 * 60_000
const now = 100 * HOUR

async function seed(convex: ReturnType<typeof convexTest>) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('billingAccounts', {
      billingAccountId: 'ba-holds', scope: 'workspace', workspaceId: 'ws-holds', status: 'active', pricingVersion: 'markup_25_v1',
      markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('billingAccountBalances', {
      billingAccountId: 'ba-holds', mode: 'budgeted', includedMicros: 20_000_000, institutionalGrantMicros: 0,
      allowanceUsedMicros: 0, topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0,
      // Three holds of 1,000,000 micros ($1.00 each) are counted as reserved.
      reservedMicros: 3_000_000, version: 1, createdAt: 1, updatedAt: 1,
    })
    const hold = (reservationId: string, errorMessage: string, updatedAt: number) => ctx.db.insert('budgetReservations', {
      userId: 'user-holds', billingAccountId: 'ba-holds', spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1',
      reservationId, status: 'reconcile_required', kind: 'agent', modelId: 'claude-sonnet-4-6', operationId: `op-${reservationId}`,
      reservedCents: 100, createdAt: updatedAt - 1_000, updatedAt, errorMessage,
      providerWorkStarted: true, providerWorkCompleted: false, reconciliationAttempts: 1,
    })
    await hold('overran', 'actual_cost_exceeds_reservation', now - 10 * HOUR)
    await hold('failed', 'No object generated: response did not match schema.', now - 10 * HOUR)
    await hold('fresh', 'No object generated: response did not match schema.', now - HOUR)
  })
}

const state = (convex: ReturnType<typeof convexTest>) => convex.run(async (ctx) => {
  const rows = await ctx.db.query('budgetReservations').collect()
  const balance = await ctx.db.query('billingAccountBalances').first()
  return {
    status: Object.fromEntries(rows.map((row) => [row.reservationId, row.status])),
    finalizedCents: Object.fromEntries(rows.map((row) => [row.reservationId, row.finalizedCents])),
    reason: Object.fromEntries(rows.map((row) => [row.reservationId, row.reconciliationEvidenceSource])),
    reservedMicros: balance!.reservedMicros, usedMicros: balance!.usedMicros,
  }
})

describe('Convex stale usage holds', () => {
  test('after the grace period, an overrun is charged what was held and a failed call is released; fresh holds wait', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const result = await convex.mutation(internal.platform.usage.settleStaleBudgetReservationsInternal, { now })
    expect(result).toEqual({ finalized: 1, released: 1, failed: 0 })
    const after = await state(convex)
    expect(after.status).toEqual({ overran: 'finalized', failed: 'released', fresh: 'reconcile_required' })
    expect(after.finalizedCents.overran).toBe(100)
    expect(after.reason.failed).toBe('system:stale-hold-policy')
    // The released hold is given back; the overrun's hold becomes spend; only the fresh hold is still held.
    expect(after.reservedMicros).toBe(1_000_000)
    expect(after.usedMicros).toBe(1_000_000)
  })

  test('running the sweep again changes nothing', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    await convex.mutation(internal.platform.usage.settleStaleBudgetReservationsInternal, { now })
    const before = await state(convex)
    expect(await convex.mutation(internal.platform.usage.settleStaleBudgetReservationsInternal, { now })).toEqual({ finalized: 0, released: 0, failed: 0 })
    expect(await state(convex)).toEqual(before)
  })
})
