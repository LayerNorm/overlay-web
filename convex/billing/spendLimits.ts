import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const MICROS_PER_CENT = 10_000
const subjectValidator = v.object({
  id: v.string(),
  kind: v.union(v.literal('member'), v.literal('programmatic')),
})
const limitValidator = v.object({
  billingAccountId: v.string(),
  createdAt: v.number(),
  limitCents: v.number(),
  periodEnd: v.number(),
  periodStart: v.number(),
  reservedCents: v.number(),
  subject: subjectValidator,
  updatedAt: v.number(),
  usedCents: v.number(),
  version: v.number(),
})

export const getByServer = query({
  args: {
    billingAccountId: v.string(),
    serverSecret: v.string(),
    subject: subjectValidator,
  },
  returns: v.union(limitValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q
        .eq('billingAccountId', args.billingAccountId.trim())
        .eq('subjectKind', args.subject.kind)
        .eq('subjectId', args.subject.id.trim()))
      .unique()
    return row ? record(row) : null
  },
})

export const upsertByServer = mutation({
  args: {
    billingAccountId: v.string(),
    limitCents: v.number(),
    periodEnd: v.number(),
    periodStart: v.number(),
    serverSecret: v.string(),
    subject: subjectValidator,
  },
  returns: limitValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const billingAccountId = args.billingAccountId.trim()
    const subjectId = args.subject.id.trim()
    const limitMicros = centsToMicros(args.limitCents)
    if (!billingAccountId || !subjectId) throw new Error('billing_spend_limit_identity_required')
    if (!Number.isFinite(args.periodStart) || !Number.isFinite(args.periodEnd) || args.periodEnd <= args.periodStart) {
      throw new Error('billing_spend_limit_period_invalid')
    }
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
      .unique()
    if (!account || account.status !== 'active') throw new Error('billing_account_inactive')
    const existing = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q
        .eq('billingAccountId', billingAccountId)
        .eq('subjectKind', args.subject.kind)
        .eq('subjectId', subjectId))
      .unique()
    const now = Date.now()
    if (existing) {
      const samePeriod = existing.periodStart === args.periodStart && existing.periodEnd === args.periodEnd
      if (!samePeriod && existing.reservedMicros > 0) {
        throw new Error('billing_spend_limit_period_has_reservations')
      }
      const usedMicros = samePeriod ? existing.usedMicros : 0
      const reservedMicros = samePeriod ? existing.reservedMicros : 0
      if (usedMicros + reservedMicros > limitMicros) throw new Error('billing_spend_limit_below_committed')
      await ctx.db.patch(existing._id, {
        limitMicros,
        periodEnd: args.periodEnd,
        periodStart: args.periodStart,
        reservedMicros,
        updatedAt: now,
        usedMicros,
        version: existing.version + 1,
      })
      return record({ ...existing, limitMicros, periodEnd: args.periodEnd, periodStart: args.periodStart, reservedMicros, updatedAt: now, usedMicros, version: existing.version + 1 })
    }
    const id = await ctx.db.insert('billingAccountSpendLimits', {
      billingAccountId,
      createdAt: now,
      limitMicros,
      periodEnd: args.periodEnd,
      periodStart: args.periodStart,
      reservedMicros: 0,
      subjectId,
      subjectKind: args.subject.kind,
      updatedAt: now,
      usedMicros: 0,
      version: 0,
    })
    const created = await ctx.db.get(id)
    if (!created) throw new Error('billing_spend_limit_creation_failed')
    return record(created)
  },
})

function centsToMicros(cents: number): number {
  if (!Number.isFinite(cents) || cents < 0) throw new Error('billing_spend_limit_invalid')
  return Math.round(cents * MICROS_PER_CENT)
}

function record(row: {
  billingAccountId: string
  createdAt: number
  limitMicros: number
  periodEnd: number
  periodStart: number
  reservedMicros: number
  subjectId: string
  subjectKind: 'member' | 'programmatic'
  updatedAt: number
  usedMicros: number
  version: number
}) {
  return {
    billingAccountId: row.billingAccountId,
    createdAt: row.createdAt,
    limitCents: row.limitMicros / MICROS_PER_CENT,
    periodEnd: row.periodEnd,
    periodStart: row.periodStart,
    reservedCents: row.reservedMicros / MICROS_PER_CENT,
    subject: { id: row.subjectId, kind: row.subjectKind },
    updatedAt: row.updatedAt,
    usedCents: row.usedMicros / MICROS_PER_CENT,
    version: row.version,
  }
}
