import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { internalMutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { totalUsage, usageResourceFor, type UsageRow } from '../../src/shared/billing/usage-resources'

const DAY_MS = 24 * 60 * 60 * 1000
/** Historical finalized reservations; nothing creates them any more, so a period holds few if any. */
const MAX_RESERVATIONS = 2_000
/** One day of charges, read individually only for the partial day a period starts on. */
const MAX_PARTIAL_DAY_CHARGES = 8_000
/** Day rows in a period: days × people × resources × models. */
const MAX_DAY_ROWS = 8_000

const totalValidator = v.object({
  resource: v.string(),
  cents: v.number(),
  count: v.number(),
  tokens: v.number(),
  seconds: v.number(),
  byModel: v.optional(v.array(v.object({ modelId: v.string(), cents: v.number(), count: v.number(), tokens: v.number() }))),
})

type UsageOperationFields = Omit<Doc<'usageOperations'>, '_id' | '_creationTime' | 'inDailyTotals'>

/**
 * Records a usage operation and, when it charged something to an account, adds it to that account's daily totals.
 * Every writer of `usageOperations` goes through here so the totals never miss a charge.
 */
export async function insertUsageOperation(ctx: Pick<MutationCtx, 'db'>, row: UsageOperationFields) {
  const counted = await addToDailyTotals(ctx, row)
  return await ctx.db.insert('usageOperations', { ...row, ...(counted ? { inDailyTotals: true } : {}) })
}

/** Adds one charge to its day row. False when the operation charged nothing or has no account. */
async function addToDailyTotals(ctx: Pick<MutationCtx, 'db'>, row: UsageOperationFields): Promise<boolean> {
  if (!row.billingAccountId || !row.kind || !row.cents || row.cents <= 0) return false
  const resource = usageResourceFor({ kind: row.kind, operationId: row.operationId, modelId: row.modelId })
  const modelId = resource === 'models' ? row.modelId || 'unknown' : ''
  const day = Math.floor(row.createdAt / DAY_MS) * DAY_MS
  const key = { billingAccountId: row.billingAccountId, day, userId: row.userId, resource, modelId }
  const existing = await ctx.db.query('usageDays')
    .withIndex('by_account_day_user_resource_model', (q) => q
      .eq('billingAccountId', key.billingAccountId).eq('day', day).eq('userId', key.userId)
      .eq('resource', resource).eq('modelId', modelId))
    .unique()
  const tokens = Math.max(0, row.usageTokens ?? 0)
  const seconds = Math.max(0, row.usageSeconds ?? 0)
  if (existing) {
    await ctx.db.patch(existing._id, {
      cents: existing.cents + row.cents,
      count: existing.count + 1,
      tokens: existing.tokens + tokens,
      seconds: existing.seconds + seconds,
    })
  } else {
    await ctx.db.insert('usageDays', { ...key, cents: row.cents, count: 1, tokens, seconds })
  }
  return true
}

/** Charges read one by one (`rows`), whole days already added up (`dayRows`), and spend per person over both. */
type PeriodCharges = { rows: UsageRow[]; dayRows: Doc<'usageDays'>[]; spentByUser: Map<string, number>; truncated: boolean }

/**
 * Every charge to the account since `periodStart`: whole UTC days from the daily totals, the partial day the period
 * starts on charge by charge, plus historical finalized reservations.
 */
async function periodCharges(ctx: Pick<QueryCtx, 'db'>, args: { billingAccountId: string; periodStart: number }): Promise<PeriodCharges> {
  const firstWholeDay = Math.ceil(args.periodStart / DAY_MS) * DAY_MS
  const [reservations, partialDay, days] = await Promise.all([
    ctx.db.query('budgetReservations')
      .withIndex('by_billingAccountId_status_createdAt', (q) => q
        .eq('billingAccountId', args.billingAccountId)
        .eq('status', 'finalized')
        .gte('createdAt', args.periodStart))
      .take(MAX_RESERVATIONS + 1),
    firstWholeDay > args.periodStart
      ? ctx.db.query('usageOperations')
          .withIndex('by_billingAccountId_createdAt', (q) => q
            .eq('billingAccountId', args.billingAccountId)
            .gte('createdAt', args.periodStart)
            .lt('createdAt', firstWholeDay))
          .take(MAX_PARTIAL_DAY_CHARGES + 1)
      : Promise.resolve([]),
    ctx.db.query('usageDays')
      .withIndex('by_account_day_user_resource_model', (q) => q
        .eq('billingAccountId', args.billingAccountId)
        .gte('day', firstWholeDay))
      .take(MAX_DAY_ROWS + 1),
  ])
  const rows: UsageRow[] = []
  const spentByUser = new Map<string, number>()
  const spend = (userId: string, cents: number) => spentByUser.set(userId, (spentByUser.get(userId) ?? 0) + cents)
  for (const row of reservations.slice(0, MAX_RESERVATIONS)) {
    rows.push({ kind: row.kind, operationId: row.operationId, modelId: row.modelId, cents: row.finalizedCents ?? 0, tokens: row.usageTokens, seconds: row.usageSeconds })
  }
  for (const row of partialDay.slice(0, MAX_PARTIAL_DAY_CHARGES)) {
    if (!row.cents || !row.kind) continue
    rows.push({ kind: row.kind, operationId: row.operationId, modelId: row.modelId, cents: row.cents, tokens: row.usageTokens, seconds: row.usageSeconds })
    spend(row.userId, row.cents)
  }
  const dayRows = days.slice(0, MAX_DAY_ROWS)
  for (const day of dayRows) spend(day.userId, day.cents)
  return {
    rows,
    dayRows,
    spentByUser,
    truncated: reservations.length > MAX_RESERVATIONS || partialDay.length > MAX_PARTIAL_DAY_CHARGES || days.length > MAX_DAY_ROWS,
  }
}

/**
 * The itemized usage list for a workspace billing account: every charge settled since `periodStart` (usage
 * operations that record their own amount, plus reservations finalized before holds were removed), added up per
 * resource.
 */
export const usageTotalsByServer = query({
  args: { billingAccountId: v.string(), periodStart: v.number(), serverSecret: v.string() },
  returns: v.object({ totals: v.array(totalValidator), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await usageTotalsFor(ctx, args)
  },
})

/** Per-resource totals of everything charged to the account since `periodStart`. */
export async function usageTotalsFor(ctx: Pick<QueryCtx, 'db'>, args: { billingAccountId: string; periodStart: number }) {
  const charges = await periodCharges(ctx, args)
  const totals = totalUsage(charges.rows)
  for (const day of charges.dayRows) addDayRow(totals, day)
  totals.sort((a, b) => b.cents - a.cents)
  for (const total of totals) total.byModel?.sort((a, b) => b.cents - a.cents)
  return { totals, truncated: charges.truncated }
}

/** What each person was charged since `periodStart`, in cents. */
export async function spendByUserFor(ctx: Pick<QueryCtx, 'db'>, args: { billingAccountId: string; periodStart: number }) {
  const charges = await periodCharges(ctx, args)
  return { spent: charges.spentByUser, truncated: charges.truncated }
}

function addDayRow(totals: ReturnType<typeof totalUsage>, day: Doc<'usageDays'>) {
  const resource = day.resource as ReturnType<typeof totalUsage>[number]['resource']
  let total = totals.find((entry) => entry.resource === resource)
  if (!total) {
    total = { resource, cents: 0, count: 0, tokens: 0, seconds: 0 }
    totals.push(total)
  }
  total.cents += day.cents
  total.count += day.count
  total.tokens += day.tokens
  total.seconds += day.seconds
  if (resource === 'models') {
    total.byModel ??= []
    let model = total.byModel.find((entry) => entry.modelId === day.modelId)
    if (!model) {
      model = { modelId: day.modelId, cents: 0, count: 0, tokens: 0 }
      total.byModel.push(model)
    }
    model.cents += day.cents
    model.count += day.count
    model.tokens += day.tokens
  }
}

/**
 * One-time: counts usage operations written before the daily totals existed. Idempotent (each row is marked when
 * counted) and safe beside live writes; reschedules itself until no uncounted row is left.
 */
export const backfillDailyTotals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query('usageOperations')
      .withIndex('by_inDailyTotals', (q) => q.eq('inDailyTotals', undefined))
      .take(400)
    for (const row of batch) {
      await addToDailyTotals(ctx, row)
      await ctx.db.patch(row._id, { inDailyTotals: true })
    }
    if (batch.length === 400) await ctx.scheduler.runAfter(0, internal.billing.usageTotals.backfillDailyTotals, {})
    return { counted: batch.length, done: batch.length < 400 }
  },
})
