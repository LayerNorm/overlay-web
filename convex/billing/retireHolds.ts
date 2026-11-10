import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { internalMutation, type MutationCtx } from '../_generated/server'
import { canceledPlanCreditPatch } from './accountModel'
import { chargeSandboxSpendLimits } from '../lib/sandboxSpendLimits'

/**
 * One-time release of the holds left from before the workspace-budget-only change (see
 * internal/plans/WORKSPACE_BUDGET_ONLY_PLAN.md). Nothing creates holds any more, so every hold still open is
 * released, never charged: its amount becomes available again. Run on each backend after the code that stops
 * creating holds is live:
 *
 *   npx convex run --prod billing/retireHolds:releaseRetiredHoldsInternal '{}'
 *
 * It works in bounded batches and schedules itself until no open hold is left, first `budgetReservations`
 * (`reserved` and `reconcile_required` rows), then the legacy runtime holds on machine leases. Rerunning it is safe:
 * released rows are not open any more, and a cleared lease hold is zero.
 */
export const RETIRED_HOLD_REASON = 'holds_retired'
const DEFAULT_BATCH = 50
const MAX_BATCH = 200

const resultValidator = v.object({ released: v.number(), releasedMicros: v.number(), done: v.boolean() })

export const releaseRetiredHoldsInternal = internalMutation({
  args: { batchSize: v.optional(v.number()), continue: v.optional(v.boolean()) },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const batchSize = batchSizeOf(args.batchSize)
    const now = Date.now()
    let released = 0
    let releasedMicros = 0
    for (const status of ['reserved', 'reconcile_required'] as const) {
      const rows = await ctx.db.query('budgetReservations')
        .withIndex('by_status_createdAt', (q) => q.eq('status', status))
        .take(batchSize - released)
      for (const row of rows) {
        // Sequential on purpose: rows of one account rewrite the same balance.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        releasedMicros += await releaseReservation(ctx, row, now)
        released += 1
      }
      if (released >= batchSize) break
    }
    const done = released < batchSize
    if (args.continue !== false) {
      if (!done) {
        await ctx.scheduler.runAfter(0, internal.billing.retireHolds.releaseRetiredHoldsInternal, { batchSize })
      } else {
        await ctx.scheduler.runAfter(0, internal.billing.retireHolds.releaseRetiredLeaseHoldsInternal, { batchSize })
      }
    }
    return { released, releasedMicros, done }
  },
})

export const releaseRetiredLeaseHoldsInternal = internalMutation({
  args: { batchSize: v.optional(v.number()), cursor: v.optional(v.string()), continue: v.optional(v.boolean()) },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const page = await ctx.db.query('agentSandboxLeases')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSizeOf(args.batchSize) })
    const now = Date.now()
    let released = 0
    let releasedMicros = 0
    for (const lease of page.page) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const micros = await releaseLeaseHold(ctx, lease, now)
      if (micros > 0) {
        released += 1
        releasedMicros += micros
      }
    }
    if (!page.isDone && args.continue !== false) {
      await ctx.scheduler.runAfter(0, internal.billing.retireHolds.releaseRetiredLeaseHoldsInternal, {
        batchSize: args.batchSize, cursor: page.continueCursor,
      })
    }
    return { released, releasedMicros, done: page.isDone }
  },
})

function batchSizeOf(value: number | undefined): number {
  return Math.min(Math.max(Math.floor(value ?? DEFAULT_BATCH), 1), MAX_BATCH)
}

/** Releases one open reservation; returns the micros given back to a workspace balance (0 for personal holds). */
async function releaseReservation(ctx: MutationCtx, row: Doc<'budgetReservations'>, now: number): Promise<number> {
  const heldMicros = Math.max(0, Math.round(row.reservedCents * 10_000))
  let releasedMicros = 0
  const account = row.billingAccountId
    ? await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', row.billingAccountId!)).unique()
    : null
  // Only workspace accounts hold credit. A personal hold has no balance behind it; marking it released is all.
  if (account?.scope === 'workspace' && heldMicros > 0) {
    const balance = await ctx.db.query('billingAccountBalances')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId)).unique()
    if (balance) {
      releasedMicros = Math.min(heldMicros, balance.reservedMicros)
      await releaseBalance(ctx, balance, releasedMicros, now)
    }
    if (row.spendSubjectKind && row.spendSubjectId) {
      const limit = await ctx.db.query('billingAccountSpendLimits')
        .withIndex('by_account_subject', (q) => q.eq('billingAccountId', account.billingAccountId)
          .eq('subjectKind', row.spendSubjectKind!).eq('subjectId', row.spendSubjectId!)).unique()
      if (limit && limit.reservedMicros > 0) {
        await ctx.db.patch(limit._id, {
          reservedMicros: Math.max(0, limit.reservedMicros - heldMicros),
          updatedAt: now,
          version: limit.version + 1,
        })
      }
    }
  }
  await ctx.db.patch(row._id, {
    status: 'released',
    errorMessage: RETIRED_HOLD_REASON,
    reconciliationReason: RETIRED_HOLD_REASON,
    updatedAt: now,
  })
  return releasedMicros
}

async function releaseBalance(ctx: MutationCtx, balance: Doc<'billingAccountBalances'>, micros: number, now: number) {
  if (micros <= 0) return
  const reservedMicros = Math.max(0, balance.reservedMicros - micros)
  await ctx.db.patch(balance._id, {
    // A canceled plan keeps only enough included credit for what is used or held, so it shrinks with the hold.
    ...await canceledPlanCreditPatch(ctx, balance, balance.usedMicros, reservedMicros),
    reservedMicros,
    updatedAt: now,
    version: balance.version + 1,
  })
}

type LeaseHoldPayer = {
  scope?: string
  billingAccountId?: string
  userId?: string
  spendSubjectKind?: 'member' | 'programmatic'
  spendSubjectId?: string
}

/**
 * Clears a lease's legacy runtime hold (from the ten-minute coverage hold) without charging. A running lease would
 * also release it on its next meter tick; stopped leases are never metered again, so they need this.
 */
async function releaseLeaseHold(ctx: MutationCtx, lease: Doc<'agentSandboxLeases'>, now: number): Promise<number> {
  const usage = (lease.usage ?? {}) as Record<string, unknown>
  const holdMicros = typeof usage.runtimeHoldMicros === 'number' && Number.isSafeInteger(usage.runtimeHoldMicros)
    ? Math.max(0, usage.runtimeHoldMicros) : 0
  if (holdMicros <= 0) return 0
  const payer = (usage.runtimeHoldPayer ?? null) as LeaseHoldPayer | null
  let releasedMicros = 0
  const billingAccountId = payer?.scope === 'workspace' ? payer.billingAccountId?.trim() : undefined
  if (billingAccountId) {
    const balance = await ctx.db.query('billingAccountBalances')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId)).unique()
    if (balance) {
      releasedMicros = Math.min(holdMicros, balance.reservedMicros)
      await releaseBalance(ctx, balance, releasedMicros, now)
    }
    if (payer?.userId) {
      // With no charge this only releases the hold from the member's and agent's spend limits.
      await chargeSandboxSpendLimits(ctx, {
        billingAccountId, userId: payer.userId, spendSubjectKind: payer.spendSubjectKind,
        spendSubjectId: payer.spendSubjectId, usage, previousHoldMicros: holdMicros, chargeMicros: 0, now,
      })
    }
  }
  await ctx.db.patch(lease._id, {
    usage: { ...usage, runtimeHoldMicros: 0, runtimeHoldPayer: null, runtimeHoldLimits: [], runtimeHoldLimitId: null },
    updatedAt: now,
  })
  return releasedMicros
}
