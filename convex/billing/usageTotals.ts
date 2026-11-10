import { v } from 'convex/values'
import { query, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { totalUsage } from '../../src/shared/billing/usage-resources'

/** Enough for a busy month; anything beyond is reported as `truncated` rather than silently undercounted. */
const MAX_CHARGES = 20_000

const totalValidator = v.object({
  resource: v.string(),
  cents: v.number(),
  count: v.number(),
  tokens: v.number(),
  seconds: v.number(),
  byModel: v.optional(v.array(v.object({ modelId: v.string(), cents: v.number(), count: v.number(), tokens: v.number() }))),
})

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
  const rows = await ctx.db.query('budgetReservations')
    .withIndex('by_billingAccountId_status_createdAt', (q) => q
      .eq('billingAccountId', args.billingAccountId)
      .eq('status', 'finalized')
      .gte('createdAt', args.periodStart))
    .take(MAX_CHARGES + 1)
  // Every charge now carries its amount on its usage operation. Finalized reservations are historical (nothing
  // creates them any more); they are read until the budgetReservations table is deleted.
  const operations = await ctx.db.query('usageOperations')
    .withIndex('by_billingAccountId_createdAt', (q) => q
      .eq('billingAccountId', args.billingAccountId)
      .gte('createdAt', args.periodStart))
    .take(MAX_CHARGES + 1)
  const charges = [
    ...rows.slice(0, MAX_CHARGES).map((row) => ({
      kind: row.kind,
      operationId: row.operationId,
      modelId: row.modelId,
      cents: row.finalizedCents ?? 0,
      tokens: row.usageTokens,
      seconds: row.usageSeconds,
    })),
    ...operations.slice(0, MAX_CHARGES).flatMap((row) => (row.cents && row.kind
      ? [{ kind: row.kind, operationId: row.operationId, modelId: row.modelId, cents: row.cents, tokens: row.usageTokens, seconds: row.usageSeconds }]
      : [])),
  ]
  return { totals: totalUsage(charges), truncated: rows.length > MAX_CHARGES || operations.length > MAX_CHARGES }
}
