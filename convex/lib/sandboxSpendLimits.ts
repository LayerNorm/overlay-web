import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

type SpendSubject = { kind: 'member' | 'programmatic'; id: string }
type HeldLimit = { id: string; periodStart: number }

/**
 * Adds an observed machine charge to the admin spend limits of the member and, when an agent pays, the agent.
 * Nothing is held: a lease that still carries a hold from before holds were removed has it released here.
 * `limitReached` says a limit is now used up (or outside its period), so the caller stops the machine.
 */
export async function chargeSandboxSpendLimits(ctx: MutationCtx, input: {
  billingAccountId: string
  userId: string
  spendSubjectKind?: SpendSubject['kind']
  spendSubjectId?: string
  usage: Record<string, unknown>
  previousHoldMicros: number
  chargeMicros: number
  now: number
}): Promise<{ limitReached: boolean }> {
  const subjects: SpendSubject[] = [{ kind: 'member', id: input.userId }]
  if (input.spendSubjectKind && input.spendSubjectId
    && !(input.spendSubjectKind === 'member' && input.spendSubjectId === input.userId)) {
    subjects.push({ kind: input.spendSubjectKind, id: input.spendSubjectId })
  }
  let limitReached = false
  for (const subject of subjects) {
    const row = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q.eq('billingAccountId', input.billingAccountId)
        .eq('subjectKind', subject.kind).eq('subjectId', subject.id)).unique()
    if (!row) continue
    const heldMicros = legacyHeldLimitMicros(row, input.usage, input.previousHoldMicros)
    const usedMicros = row.usedMicros + input.chargeMicros
    const reservedMicros = row.reservedMicros - heldMicros
    if (input.chargeMicros > 0 || heldMicros > 0) {
      await ctx.db.patch(row._id, { reservedMicros, usedMicros, updatedAt: input.now, version: row.version + 1 })
    }
    if (input.now < row.periodStart || input.now >= row.periodEnd || usedMicros + reservedMicros >= row.limitMicros) {
      limitReached = true
    }
  }
  return { limitReached }
}

function legacyHeldLimitMicros(row: Doc<'billingAccountSpendLimits'>, usage: Record<string, unknown>, previousHoldMicros: number) {
  if (previousHoldMicros <= 0) return 0
  const limits = usage.runtimeHoldLimits as HeldLimit[] | undefined
  const samePeriod = limits
    ? limits.some((limit) => limit.id === row._id && limit.periodStart === row.periodStart)
    : usage.runtimeHoldLimitId === row._id && typeof usage.meteredAt === 'number'
      && usage.meteredAt >= row.periodStart && usage.meteredAt < row.periodEnd
  return samePeriod ? Math.min(previousHoldMicros, row.reservedMicros) : 0
}
