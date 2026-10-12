import { v } from 'convex/values'
import { query } from '../_generated/server'
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
 * The itemized usage list for a workspace billing account: every charge settled since `periodStart` (finalized
 * reservations), added up per resource.
 */
export const usageTotalsByServer = query({
  args: { billingAccountId: v.string(), periodStart: v.number(), serverSecret: v.string() },
  returns: v.object({ totals: v.array(totalValidator), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('budgetReservations')
      .withIndex('by_billingAccountId_status_createdAt', (q) => q
        .eq('billingAccountId', args.billingAccountId)
        .eq('status', 'finalized')
        .gte('createdAt', args.periodStart))
      .take(MAX_CHARGES + 1)
    const charges = rows.slice(0, MAX_CHARGES).map((row) => ({
      kind: row.kind,
      operationId: row.operationId,
      modelId: row.modelId,
      cents: row.finalizedCents ?? 0,
      tokens: row.usageTokens,
      seconds: row.usageSeconds,
    }))
    return { totals: totalUsage(charges), truncated: rows.length > MAX_CHARGES }
  },
})
