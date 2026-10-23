import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

type SpendSubject = { kind: 'member' | 'programmatic'; id: string }
type HeldLimit = { id: string; periodStart: number }
type PlannedLimit = { row: Doc<'billingAccountSpendLimits'>; previousMicros: number }

export async function prepareSandboxSpendLimits(ctx: MutationCtx, input: {
  billingAccountId: string
  userId: string
  spendSubjectKind?: SpendSubject['kind']
  spendSubjectId?: string
  usage: Record<string, unknown>
  previousHoldMicros: number
  holdMicros: number
  chargeMicros: number
  now: number
}): Promise<{ ok: true; limits: PlannedLimit[] } | { ok: false; remainingMicros: number }> {
  const subjects: SpendSubject[] = [{ kind: 'member', id: input.userId }]
  if (input.spendSubjectKind && input.spendSubjectId
    && !(input.spendSubjectKind === 'member' && input.spendSubjectId === input.userId)) {
    subjects.push({ kind: input.spendSubjectKind, id: input.spendSubjectId })
  }
  const limits: PlannedLimit[] = []
  let remainingMicros = Number.POSITIVE_INFINITY
  for (const subject of subjects) {
    const row = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q.eq('billingAccountId', input.billingAccountId)
        .eq('subjectKind', subject.kind).eq('subjectId', subject.id)).unique()
    if (!row) continue
    const previousMicros = heldLimitMicros(row, input.usage, input.previousHoldMicros)
    const available = input.now >= row.periodStart && input.now < row.periodEnd
      ? Math.max(0, row.limitMicros - row.usedMicros - row.reservedMicros + previousMicros) : 0
    remainingMicros = Math.min(remainingMicros, input.holdMicros === 0 ? Math.max(available, previousMicros) : available)
    limits.push({ row, previousMicros })
  }
  if (input.chargeMicros + input.holdMicros > remainingMicros) return { ok: false, remainingMicros }
  return { ok: true, limits }
}

export async function applySandboxSpendLimits(ctx: MutationCtx, input: {
  limits: PlannedLimit[]
  holdMicros: number
  chargeMicros: number
  now: number
}): Promise<HeldLimit[]> {
  for (const { row, previousMicros } of input.limits) {
    await ctx.db.patch(row._id, {
      reservedMicros: row.reservedMicros - previousMicros + input.holdMicros,
      usedMicros: row.usedMicros + input.chargeMicros, updatedAt: input.now, version: row.version + 1,
    })
  }
  return input.holdMicros > 0 ? input.limits.map(({ row }) => ({ id: row._id, periodStart: row.periodStart })) : []
}

function heldLimitMicros(row: Doc<'billingAccountSpendLimits'>, usage: Record<string, unknown>, previousHoldMicros: number) {
  const limits = usage.runtimeHoldLimits as HeldLimit[] | undefined
  const samePeriod = limits
    ? limits.some((limit) => limit.id === row._id && limit.periodStart === row.periodStart)
    : usage.runtimeHoldLimitId === row._id && typeof usage.meteredAt === 'number'
      && usage.meteredAt >= row.periodStart && usage.meteredAt < row.periodEnd
  const held = samePeriod ? previousHoldMicros : 0
  if (held > row.reservedMicros) throw new Error('sandbox_runtime_hold_limit_mismatch')
  return held
}
