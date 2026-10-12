import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { ensureEmptyBalance } from './accountModel'

/**
 * Settles an automatic workspace top-up that Stripe did not finish at once (for example a card that needed 3-D
 * Secure). The Stripe webhook calls this when the payment succeeds or fails, and `reconcilePendingAutoTopUps` asks
 * Stripe for anything still pending, so a pending top-up is credited as soon as it clears, not on a later attempt.
 */
export const settlePendingTopUpInternal = internalMutation({
  args: {
    stripePaymentIntentId: v.string(),
    outcome: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('canceled')),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({ settled: v.boolean(), granted: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.query('budgetTopUps')
      .withIndex('by_paymentIntentId', (q) => q.eq('stripePaymentIntentId', args.stripePaymentIntentId))
      .unique()
    // Only rows still waiting on Stripe change; succeeded ones were already credited.
    if (!row || row.status !== 'pending' || !row.billingAccountId) return { settled: false, granted: false }
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', row.billingAccountId!))
      .unique()
    if (!account || account.scope !== 'workspace') return { settled: false, granted: false }
    const now = Date.now()
    await ctx.db.patch(row._id, {
      status: args.outcome,
      updatedAt: now,
      ...(args.errorMessage ? { errorMessage: args.errorMessage.slice(0, 500) } : {}),
    })
    if (args.outcome !== 'succeeded') return { settled: true, granted: false }
    const balance = await ensureEmptyBalance(ctx, row.billingAccountId)
    const amountMicros = row.amountCents * 10_000
    await ctx.db.patch(balance._id, {
      topUpPurchasedMicros: balance.topUpPurchasedMicros + amountMicros,
      topUpBalanceMicros: balance.topUpBalanceMicros + amountMicros,
      updatedAt: now,
      version: balance.version + 1,
    })
    return { settled: true, granted: true }
  },
})

/** Automatic workspace top-ups still pending at least `olderThanMs` after they were created (newest first). */
export const listPendingAutoTopUpsInternal = internalQuery({
  args: { olderThanMs: v.number(), limit: v.number() },
  returns: v.array(v.object({ stripePaymentIntentId: v.string(), createdAt: v.number() })),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs
    const rows = await ctx.db.query('budgetTopUps').order('desc').take(2_000)
    return rows
      .filter((row) => row.status === 'pending' && row.source === 'auto' && row.billingAccountId
        && row.stripePaymentIntentId && row.createdAt <= cutoff)
      .slice(0, args.limit)
      .map((row) => ({ stripePaymentIntentId: row.stripePaymentIntentId!, createdAt: row.createdAt }))
  },
})
