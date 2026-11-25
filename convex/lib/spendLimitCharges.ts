import type { Doc } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { rolledSpendLimitWindow, spendLimitReachedNow } from '../../src/shared/billing/spend-limit-period'

type LimitRow = Doc<'billingAccountSpendLimits'>
export type SpendSubject = { kind: 'member' | 'programmatic'; id: string }

/**
 * The limits a charge counts against: always the person who triggered it (a per-person cap covers everything they
 * start, their automations and agents included), and the program as well when one pays.
 */
export function spendSubjectsFor(userId: string, programmatic?: SpendSubject): SpendSubject[] {
  const subjects: SpendSubject[] = [{ kind: 'member', id: userId }]
  if (programmatic?.id && !(programmatic.kind === 'member' && programmatic.id === userId)) subjects.push(programmatic)
  return subjects
}

export async function spendLimitRow(ctx: Pick<QueryCtx, 'db'>, billingAccountId: string, subject: SpendSubject): Promise<LimitRow | null> {
  return await ctx.db.query('billingAccountSpendLimits')
    .withIndex('by_account_subject', (q) => q.eq('billingAccountId', billingAccountId)
      .eq('subjectKind', subject.kind).eq('subjectId', subject.id))
    .unique()
}

export function limitRowReached(row: LimitRow, now: number): boolean {
  return spendLimitReachedNow({ periodStart: row.periodStart, periodEnd: row.periodEnd, used: row.usedMicros, reserved: row.reservedMicros, limit: row.limitMicros }, now)
}

/** Whether any limit this person (or program) spends under is used up right now. */
export async function spendLimitsReached(ctx: Pick<QueryCtx, 'db'>, args: {
  billingAccountId: string
  subjects: SpendSubject[]
  now: number
}): Promise<boolean> {
  for (const subject of args.subjects) {
    const row = await spendLimitRow(ctx, args.billingAccountId, subject)
    if (row && limitRowReached(row, args.now)) return true
  }
  return false
}

/**
 * Adds a settled charge to every limit it counts against, renewing a limit whose period has ended first. Returns
 * whether a limit is now used up, so a loop stops.
 */
export async function chargeSpendLimits(ctx: MutationCtx, args: {
  billingAccountId: string
  subjects: SpendSubject[]
  micros: number
  now: number
}): Promise<{ limitReached: boolean }> {
  let limitReached = false
  for (const subject of args.subjects) {
    const row = await spendLimitRow(ctx, args.billingAccountId, subject)
    if (!row) continue
    const rolled = rolledSpendLimitWindow(row, args.now)
    const next = {
      ...(rolled ?? {}),
      usedMicros: (rolled ? 0 : row.usedMicros) + Math.max(0, args.micros),
      updatedAt: args.now,
      version: row.version + 1,
    }
    if (args.micros > 0 || rolled) await ctx.db.patch(row._id, next)
    if (limitRowReached({ ...row, ...next }, args.now)) limitReached = true
  }
  return { limitReached }
}
