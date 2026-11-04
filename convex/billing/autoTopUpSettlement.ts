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
    billingAccountId: v.optional(v.string()),
    intentKey: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    userId: v.optional(v.string()),
    customerId: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  returns: v.object({ settled: v.boolean(), granted: v.boolean() }),
  handler: async (ctx, args) => {
    let row = await ctx.db.query('budgetTopUps')
      .withIndex('by_paymentIntentId', (q) => q.eq('stripePaymentIntentId', args.stripePaymentIntentId))
      .unique()
    if (!row && args.billingAccountId && args.intentKey && args.workspaceId
      && args.userId && args.customerId && Number.isSafeInteger(args.amountCents)) {
      const claim = await ctx.db.query('billingAutoTopUpIntents')
        .withIndex('by_billingAccountId_intentKey', (q) => q
          .eq('billingAccountId', args.billingAccountId!).eq('intentKey', args.intentKey!))
        .unique()
      const account = await ctx.db.query('billingAccounts')
        .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId!))
        .unique()
      const plan = await ctx.db.query('billingAccountSubscriptions')
        .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId!))
        .unique()
      if (!claim || claim.workspaceId !== args.workspaceId || claim.actorUserId !== args.userId
        || claim.customerId !== args.customerId || claim.amountCents !== args.amountCents
        || claim.stripePaymentIntentId && claim.stripePaymentIntentId !== args.stripePaymentIntentId
        || args.currency !== 'usd'
        || !account || account.scope !== 'workspace' || account.workspaceId !== claim.workspaceId
        || account.status !== 'active' || !plan || plan.planKind !== 'paid' || plan.status !== 'active') {
        return { settled: false, granted: false }
      }
      const createdAt = Date.now()
      const topUpId = await ctx.db.insert('budgetTopUps', {
        userId: claim.actorUserId, billingAccountId: claim.billingAccountId,
        workspaceId: claim.workspaceId,
        stripeCustomerId: claim.customerId, stripePaymentIntentId: args.stripePaymentIntentId,
        autoTopUpIntentKey: claim.intentKey, billingPeriodStart: claim.currentPeriodStart ?? claim.createdAt,
        amountCents: claim.amountCents, source: 'auto',
        status: args.outcome === 'succeeded' ? 'succeeded' : args.outcome === 'canceled' ? 'canceled' : 'failed',
        createdAt, updatedAt: createdAt,
        ...(args.errorMessage ? { errorMessage: args.errorMessage.slice(0, 500) } : {}),
      })
      row = await ctx.db.get(topUpId)
      await ctx.db.patch(claim._id, {
        state: args.outcome === 'succeeded' ? 'succeeded' : 'payment_failed',
        stripePaymentIntentId: args.stripePaymentIntentId, updatedAt: createdAt,
      })
      if (args.outcome === 'succeeded') {
        const balance = await ensureEmptyBalance(ctx, claim.billingAccountId)
        const amountMicros = claim.amountCents * 10_000
        await ctx.db.patch(balance._id, {
          topUpPurchasedMicros: balance.topUpPurchasedMicros + amountMicros,
          topUpBalanceMicros: balance.topUpBalanceMicros + amountMicros,
          updatedAt: createdAt, version: balance.version + 1,
        })
        return { settled: true, granted: true }
      }
      return { settled: true, granted: false }
    }
    // Only rows still waiting on Stripe change; succeeded ones were already credited.
    if (!row || row.status !== 'pending' || row.source !== 'auto' || !row.billingAccountId
      || args.billingAccountId !== row.billingAccountId
      || args.intentKey !== row.autoTopUpIntentKey
      || (row.workspaceId !== undefined && args.workspaceId !== row.workspaceId)
      || args.userId !== row.userId
      || args.customerId !== row.stripeCustomerId
      || args.amountCents !== row.amountCents
      || args.currency !== 'usd') return { settled: false, granted: false }
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', row.billingAccountId!))
      .unique()
    const claim = row.autoTopUpIntentKey
      ? await ctx.db.query('billingAutoTopUpIntents')
          .withIndex('by_billingAccountId_intentKey', (q) => q
            .eq('billingAccountId', row.billingAccountId!).eq('intentKey', row.autoTopUpIntentKey!))
          .unique()
      : null
    const plan = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', row.billingAccountId!))
      .unique()
    const legacy = row.autoTopUpIntentKey === undefined && args.intentKey === undefined
    if (!account || account.scope !== 'workspace' || account.workspaceId !== args.workspaceId
      || account.status !== 'active'
      || (!legacy && (!claim || claim.workspaceId !== row.workspaceId
        || claim.actorUserId !== row.userId || claim.customerId !== row.stripeCustomerId
        || claim.amountCents !== row.amountCents || claim.stripePaymentIntentId !== args.stripePaymentIntentId))
      || !plan || plan.planKind !== 'paid' || plan.status !== 'active') {
      return { settled: false, granted: false }
    }
    const now = Date.now()
    await ctx.db.patch(row._id, {
      status: args.outcome,
      updatedAt: now,
      ...(args.errorMessage ? { errorMessage: args.errorMessage.slice(0, 500) } : {}),
    })
    if (claim) await ctx.db.patch(claim._id, {
      state: args.outcome === 'succeeded' ? 'succeeded' : 'payment_failed',
      updatedAt: now,
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
