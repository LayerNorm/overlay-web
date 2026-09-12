import { v } from 'convex/values'
import { internalMutation, mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { ensureEmptyBalance } from './accountModel'

const subscriptionStatus = v.union(
  v.literal('active'),
  v.literal('canceled'),
  v.literal('past_due'),
  v.literal('trialing'),
)

const subscriptionRecord = v.object({
  billingAccountId: v.string(),
  stripeCustomerId: v.optional(v.string()),
  stripeSubscriptionId: v.optional(v.string()),
  tier: v.union(v.literal('free'), v.literal('pro'), v.literal('max')),
  planKind: v.union(v.literal('free'), v.literal('paid')),
  planAmountCents: v.number(),
  status: subscriptionStatus,
  autoTopUpEnabled: v.boolean(),
  autoTopUpAmountCents: v.number(),
  offSessionConsentAt: v.optional(v.number()),
  currentPeriodStart: v.optional(v.number()),
  currentPeriodEnd: v.optional(v.number()),
})

export const getByServer = query({
  args: { billingAccountId: v.string(), serverSecret: v.string() },
  returns: v.union(subscriptionRecord, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId.trim()))
      .unique()
    if (!row) return null
    return {
      billingAccountId: row.billingAccountId,
      ...(row.providerCustomerId ? { stripeCustomerId: row.providerCustomerId } : {}),
      ...(row.providerSubscriptionId ? { stripeSubscriptionId: row.providerSubscriptionId } : {}),
      tier: row.planKind === 'paid' ? 'pro' as const : 'free' as const,
      planKind: row.planKind,
      planAmountCents: row.planAmountCents,
      status: row.status,
      autoTopUpEnabled: row.autoTopUpEnabled,
      autoTopUpAmountCents: row.autoTopUpAmountCents,
      ...(row.offSessionConsentAt === undefined ? {} : { offSessionConsentAt: row.offSessionConsentAt }),
      ...(row.currentPeriodStart === undefined ? {} : { currentPeriodStart: row.currentPeriodStart }),
      ...(row.currentPeriodEnd === undefined ? {} : { currentPeriodEnd: row.currentPeriodEnd }),
    }
  },
})

export const getEntitlementsByServer = query({
  args: { billingAccountId: v.string(), serverSecret: v.string() },
  returns: v.union(v.object({
    billingAccountId: v.string(),
    tier: v.union(v.literal('free'), v.literal('pro'), v.literal('max')),
    planKind: v.optional(v.union(v.literal('free'), v.literal('paid'))),
    planAmountCents: v.optional(v.number()),
    status: subscriptionStatus,
    budgetUsedCents: v.number(),
    budgetTotalCents: v.number(),
    budgetRemainingCents: v.number(),
    allowanceTotalCents: v.number(),
    allowanceUsedCents: v.number(),
    allowancePercentUsed: v.number(),
    topUpBalanceCents: v.number(),
    autoTopUpEnabled: v.boolean(),
    autoTopUpAmountCents: v.number(),
    autoTopUpConsentGranted: v.boolean(),
    creditsUsed: v.number(),
    creditsTotal: v.number(),
    billingPeriodEnd: v.optional(v.string()),
  }), v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId.trim()))
      .unique()
    if (!account || account.status !== 'active') return null
    const [balance, subscription] = await Promise.all([
      ctx.db.query('billingAccountBalances')
        .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId))
        .unique(),
      ctx.db.query('billingAccountSubscriptions')
        .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId))
        .unique(),
    ])
    if (!balance) return null
    const included = (balance.includedMicros + balance.institutionalGrantMicros) / 10_000
    const topUp = balance.topUpBalanceMicros / 10_000
    const used = balance.usedMicros / 10_000
    const reserved = balance.reservedMicros / 10_000
    const allowanceUsed = balance.allowanceUsedMicros / 10_000
    return {
      billingAccountId: account.billingAccountId,
      tier: subscription?.planKind === 'paid' ? 'pro' as const : 'free' as const,
      planKind: subscription?.planKind ?? 'free',
      planAmountCents: subscription?.planAmountCents ?? 0,
      status: subscription?.status ?? 'active',
      budgetUsedCents: used,
      budgetTotalCents: included + topUp,
      budgetRemainingCents: Math.max(0, included + topUp - used - reserved),
      allowanceTotalCents: included,
      allowanceUsedCents: allowanceUsed,
      allowancePercentUsed: included > 0 ? Math.min(100, allowanceUsed / included * 100) : 0,
      topUpBalanceCents: topUp,
      autoTopUpEnabled: subscription?.autoTopUpEnabled ?? false,
      autoTopUpAmountCents: subscription?.autoTopUpAmountCents ?? 0,
      autoTopUpConsentGranted: subscription?.offSessionConsentAt !== undefined,
      creditsUsed: used,
      creditsTotal: included + topUp,
      ...(subscription?.currentPeriodEnd === undefined
        ? {}
        : { billingPeriodEnd: new Date(subscription.currentPeriodEnd).toISOString() }),
    }
  },
})

export const upsertByServer = mutation({
  args: {
    billingAccountId: v.string(),
    serverSecret: v.string(),
    provider: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeQuantity: v.optional(v.number()),
    planKind: v.optional(v.union(v.literal('free'), v.literal('paid'))),
    planAmountCents: v.optional(v.number()),
    markupBasisPoints: v.optional(v.number()),
    status: v.optional(subscriptionStatus),
    autoTopUpEnabled: v.optional(v.boolean()),
    autoTopUpAmountCents: v.optional(v.number()),
    offSessionConsentAt: v.optional(v.number()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    providerEventCreatedAt: v.optional(v.number()),
  },
  returns: v.object({ billingAccountId: v.string(), applied: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const billingAccountId = args.billingAccountId.trim()
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
      .unique()
    if (!account) throw new Error('billing_account_not_found')
    if (account.status !== 'active') throw new Error('billing_account_inactive')
    const existing = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
      .unique()
    if (
      existing?.providerEventCreatedAt !== undefined
      && args.providerEventCreatedAt !== undefined
      && args.providerEventCreatedAt < existing.providerEventCreatedAt
    ) return { billingAccountId, applied: false }
    const now = Date.now()
    const periodChanged = existing?.currentPeriodStart !== undefined
      && args.currentPeriodStart !== undefined
      && args.currentPeriodStart - existing.currentPeriodStart >= 60 * 60 * 1000
    const planKind = args.planKind ?? existing?.planKind ?? 'free'
    const planAmountCents = Math.max(0, args.planAmountCents ?? existing?.planAmountCents ?? 0)
    const value = {
      billingAccountId,
      provider: args.provider ?? existing?.provider ?? 'stripe',
      ...(args.stripeCustomerId ?? existing?.providerCustomerId
        ? { providerCustomerId: args.stripeCustomerId ?? existing?.providerCustomerId }
        : {}),
      ...(args.stripeSubscriptionId ?? existing?.providerSubscriptionId
        ? { providerSubscriptionId: args.stripeSubscriptionId ?? existing?.providerSubscriptionId }
        : {}),
      ...(args.stripePriceId ?? existing?.providerPriceId
        ? { providerPriceId: args.stripePriceId ?? existing?.providerPriceId }
        : {}),
      ...(args.stripeQuantity ?? existing?.providerQuantity
        ? { providerQuantity: args.stripeQuantity ?? existing?.providerQuantity }
        : {}),
      planKind,
      planVersion: 'variable_v2' as const,
      planAmountCents,
      markupBasisPoints: args.markupBasisPoints ?? existing?.markupBasisPoints ?? account.markupBasisPoints,
      status: args.status ?? existing?.status ?? 'active' as const,
      autoTopUpEnabled: args.autoTopUpEnabled ?? existing?.autoTopUpEnabled ?? false,
      autoTopUpAmountCents: args.autoTopUpAmountCents ?? existing?.autoTopUpAmountCents ?? 0,
      ...(args.offSessionConsentAt ?? existing?.offSessionConsentAt
        ? { offSessionConsentAt: args.offSessionConsentAt ?? existing?.offSessionConsentAt }
        : {}),
      ...(args.currentPeriodStart ?? existing?.currentPeriodStart
        ? { currentPeriodStart: args.currentPeriodStart ?? existing?.currentPeriodStart }
        : {}),
      ...(args.currentPeriodEnd ?? existing?.currentPeriodEnd
        ? { currentPeriodEnd: args.currentPeriodEnd ?? existing?.currentPeriodEnd }
        : {}),
      ...(args.providerEventCreatedAt ?? existing?.providerEventCreatedAt
        ? { providerEventCreatedAt: args.providerEventCreatedAt ?? existing?.providerEventCreatedAt }
        : {}),
      updatedAt: now,
    }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert('billingAccountSubscriptions', { ...value, createdAt: now })
    const balance = await ensureEmptyBalance(ctx, billingAccountId)
    const includedMicros = planAmountCents * 10_000
    if (periodChanged && balance.reservedMicros > 0) throw new Error('billing_period_rollover_has_active_reservations')
    const nextUsedMicros = periodChanged ? 0 : balance.usedMicros
    const nextReservedMicros = periodChanged ? 0 : balance.reservedMicros
    const nextTopUpPurchasedMicros = periodChanged ? balance.topUpBalanceMicros : balance.topUpPurchasedMicros
    if (nextUsedMicros + nextReservedMicros
      > includedMicros + balance.institutionalGrantMicros + nextTopUpPurchasedMicros) {
      throw new Error('Subscription change would remove already consumed or reserved credits')
    }
    await ctx.db.patch(balance._id, {
      includedMicros,
      mode: 'budgeted',
      allowanceUsedMicros: periodChanged ? 0 : balance.allowanceUsedMicros,
      usedMicros: nextUsedMicros,
      reservedMicros: nextReservedMicros,
      topUpPurchasedMicros: nextTopUpPurchasedMicros,
      updatedAt: now,
      version: balance.version + 1,
    })
    return { billingAccountId, applied: true }
  },
})

export const recordTopUpByServer = mutation({
  args: {
    actorUserId: v.string(),
    amountCents: v.number(),
    billingAccountId: v.string(),
    source: v.union(v.literal('manual'), v.literal('auto')),
    status: v.union(v.literal('pending'), v.literal('succeeded'), v.literal('failed'), v.literal('canceled')),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    serverSecret: v.string(),
  },
  returns: v.object({ id: v.string(), granted: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) throw new Error('invalid_top_up_amount')
    const byCheckout = args.stripeCheckoutSessionId
      ? await ctx.db.query('budgetTopUps')
          .withIndex('by_checkoutSessionId', (q) => q.eq('stripeCheckoutSessionId', args.stripeCheckoutSessionId))
          .unique()
      : null
    const byPayment = args.stripePaymentIntentId
      ? await ctx.db.query('budgetTopUps')
          .withIndex('by_paymentIntentId', (q) => q.eq('stripePaymentIntentId', args.stripePaymentIntentId))
          .unique()
      : null
    if (byCheckout && byPayment && byCheckout._id !== byPayment._id) throw new Error('top_up_provider_reference_conflict')
    const existing = byCheckout ?? byPayment
    if (existing?.billingAccountId && existing.billingAccountId !== args.billingAccountId) {
      throw new Error('Top-up provider reference already belongs to another billing account')
    }
    if (existing && existing.amountCents !== args.amountCents) {
      throw new Error('Top-up provider reference was reused with a different amount')
    }
    const now = Date.now()
    const granted = args.status === 'succeeded' && existing?.status !== 'succeeded'
    const persistedStatus = existing?.status === 'succeeded' ? 'succeeded' as const : args.status
    let id: string
    if (existing) {
      id = String(existing._id)
      await ctx.db.patch(existing._id, {
        billingAccountId: args.billingAccountId,
        status: persistedStatus,
        updatedAt: now,
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      })
    } else {
      const inserted = await ctx.db.insert('budgetTopUps', {
        userId: args.actorUserId,
        billingAccountId: args.billingAccountId,
        amountCents: args.amountCents,
        source: args.source,
        status: args.status,
        billingPeriodStart: now,
        createdAt: now,
        updatedAt: now,
        ...(args.stripeCheckoutSessionId ? { stripeCheckoutSessionId: args.stripeCheckoutSessionId } : {}),
        ...(args.stripeCustomerId ? { stripeCustomerId: args.stripeCustomerId } : {}),
        ...(args.stripePaymentIntentId ? { stripePaymentIntentId: args.stripePaymentIntentId } : {}),
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      })
      id = String(inserted)
    }
    if (granted) {
      const balance = await ensureEmptyBalance(ctx, args.billingAccountId)
      const amountMicros = args.amountCents * 10_000
      await ctx.db.patch(balance._id, {
        topUpPurchasedMicros: balance.topUpPurchasedMicros + amountMicros,
        topUpBalanceMicros: balance.topUpBalanceMicros + amountMicros,
        updatedAt: now,
        version: balance.version + 1,
      })
    }
    return { id, granted }
  },
})

/**
 * Reverses a succeeded workspace top-up when Stripe reports a refund or lost
 * dispute. Debits the billing account balance so the credits cannot be spent.
 */
export const reverseTopUpByServer = mutation({
  args: {
    serverSecret: v.string(),
    billingAccountId: v.string(),
    stripePaymentIntentId: v.string(),
    refundAmountCents: v.number(),
    reason: v.string(),
  },
  returns: v.object({ reversed: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!Number.isSafeInteger(args.refundAmountCents) || args.refundAmountCents <= 0) {
      throw new Error('invalid_refund_amount')
    }
    const existing = await ctx.db
      .query('budgetTopUps')
      .withIndex('by_paymentIntentId', (q) => q.eq('stripePaymentIntentId', args.stripePaymentIntentId))
      .unique()
    if (!existing) return { reversed: false }
    if (existing.billingAccountId !== args.billingAccountId) {
      throw new Error('Top-up provider reference belongs to another billing account')
    }
    if (existing.status !== 'succeeded') return { reversed: false }

    const alreadyRefunded = Math.max(0, existing.refundedAmountCents ?? 0)
    const maxRefundable = existing.amountCents - alreadyRefunded
    const refundAmount = Math.min(args.refundAmountCents, maxRefundable)
    if (refundAmount <= 0) return { reversed: false }

    const balance = await ensureEmptyBalance(ctx, args.billingAccountId)
    const debitMicros = refundAmount * 10_000
    await ctx.db.patch(balance._id, {
      topUpPurchasedMicros: Math.max(0, balance.topUpPurchasedMicros - debitMicros),
      topUpBalanceMicros: Math.max(0, balance.topUpBalanceMicros - debitMicros),
      updatedAt: Date.now(),
      version: balance.version + 1,
    })
    await ctx.db.patch(existing._id, {
      status: 'refunded',
      refundedAmountCents: alreadyRefunded + refundAmount,
      updatedAt: Date.now(),
      errorMessage: args.reason,
    })
    return { reversed: true }
  },
})

export const resolveAccountIdByProviderReferenceByServer = query({
  args: {
    provider: v.string(),
    providerCustomerId: v.optional(v.string()),
    providerSubscriptionId: v.optional(v.string()),
    serverSecret: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const customer = args.providerCustomerId
      ? await ctx.db.query('billingAccountSubscriptions')
          .withIndex('by_providerCustomerId', (q) => q.eq('providerCustomerId', args.providerCustomerId))
          .unique()
      : null
    const subscription = args.providerSubscriptionId
      ? await ctx.db.query('billingAccountSubscriptions')
          .withIndex('by_providerSubscriptionId', (q) => q.eq('providerSubscriptionId', args.providerSubscriptionId))
          .unique()
      : null
    if (customer && customer.provider !== args.provider) return null
    if (subscription && subscription.provider !== args.provider) return null
    if (customer && subscription && customer.billingAccountId !== subscription.billingAccountId) {
      throw new Error('provider_reference_billing_account_conflict')
    }
    return customer?.billingAccountId ?? subscription?.billingAccountId ?? null
  },
})

export const upsertFromStripeInternal = internalMutation({
  args: {
    billingAccountId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeQuantity: v.optional(v.number()),
    planKind: v.optional(v.union(v.literal('free'), v.literal('paid'))),
    planAmountCents: v.optional(v.number()),
    status: subscriptionStatus,
    autoTopUpEnabled: v.optional(v.boolean()),
    autoTopUpAmountCents: v.optional(v.number()),
    offSessionConsentAt: v.optional(v.number()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    providerEventCreatedAt: v.number(),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId))
      .unique()
    if (!account || account.status !== 'active') throw new Error('billing_account_inactive')
    const existing = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId))
      .unique()
    if (existing?.providerEventCreatedAt !== undefined
      && args.providerEventCreatedAt < existing.providerEventCreatedAt) return { applied: false }
    const now = Date.now()
    const periodChanged = existing?.currentPeriodStart !== undefined
      && args.currentPeriodStart !== undefined
      && args.currentPeriodStart - existing.currentPeriodStart >= 60 * 60 * 1000
    const value = {
      billingAccountId: args.billingAccountId,
      provider: 'stripe',
      ...(args.stripeCustomerId ?? existing?.providerCustomerId
        ? { providerCustomerId: args.stripeCustomerId ?? existing?.providerCustomerId }
        : {}),
      ...(args.stripeSubscriptionId ?? existing?.providerSubscriptionId
        ? { providerSubscriptionId: args.stripeSubscriptionId ?? existing?.providerSubscriptionId }
        : {}),
      ...(args.stripePriceId ?? existing?.providerPriceId
        ? { providerPriceId: args.stripePriceId ?? existing?.providerPriceId }
        : {}),
      ...(args.stripeQuantity ?? existing?.providerQuantity
        ? { providerQuantity: args.stripeQuantity ?? existing?.providerQuantity }
        : {}),
      planKind: args.planKind ?? existing?.planKind ?? 'free',
      planVersion: 'variable_v2' as const,
      planAmountCents: args.planAmountCents ?? existing?.planAmountCents ?? 0,
      markupBasisPoints: account.markupBasisPoints,
      status: args.status,
      autoTopUpEnabled: args.autoTopUpEnabled ?? existing?.autoTopUpEnabled ?? false,
      autoTopUpAmountCents: args.autoTopUpAmountCents ?? existing?.autoTopUpAmountCents ?? 0,
      ...(args.offSessionConsentAt ?? existing?.offSessionConsentAt
        ? { offSessionConsentAt: args.offSessionConsentAt ?? existing?.offSessionConsentAt }
        : {}),
      ...(args.currentPeriodStart ?? existing?.currentPeriodStart
        ? { currentPeriodStart: args.currentPeriodStart ?? existing?.currentPeriodStart }
        : {}),
      ...(args.currentPeriodEnd ?? existing?.currentPeriodEnd
        ? { currentPeriodEnd: args.currentPeriodEnd ?? existing?.currentPeriodEnd }
        : {}),
      providerEventCreatedAt: args.providerEventCreatedAt,
      updatedAt: now,
    }
    if (existing) await ctx.db.patch(existing._id, value)
    else await ctx.db.insert('billingAccountSubscriptions', { ...value, createdAt: now })
    const balance = await ensureEmptyBalance(ctx, args.billingAccountId)
    const includedMicros = (args.planAmountCents ?? existing?.planAmountCents ?? 0) * 10_000
    if (periodChanged && balance.reservedMicros > 0) throw new Error('billing_period_rollover_has_active_reservations')
    const nextUsedMicros = periodChanged ? 0 : balance.usedMicros
    const nextReservedMicros = periodChanged ? 0 : balance.reservedMicros
    const nextTopUpPurchasedMicros = periodChanged ? balance.topUpBalanceMicros : balance.topUpPurchasedMicros
    if (nextUsedMicros + nextReservedMicros
      > includedMicros + balance.institutionalGrantMicros + nextTopUpPurchasedMicros) {
      throw new Error('Subscription change would remove already consumed or reserved credits')
    }
    await ctx.db.patch(balance._id, {
      includedMicros,
      allowanceUsedMicros: periodChanged ? 0 : balance.allowanceUsedMicros,
      usedMicros: nextUsedMicros,
      reservedMicros: nextReservedMicros,
      topUpPurchasedMicros: nextTopUpPurchasedMicros,
      updatedAt: now,
      version: balance.version + 1,
    })
    return { applied: true }
  },
})

export const recordTopUpInternal = internalMutation({
  args: {
    actorUserId: v.string(),
    amountCents: v.number(),
    billingAccountId: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
  },
  returns: v.object({ granted: v.boolean() }),
  handler: async (ctx, args) => {
    const byCheckout = args.stripeCheckoutSessionId
      ? await ctx.db.query('budgetTopUps')
          .withIndex('by_checkoutSessionId', (q) => q.eq('stripeCheckoutSessionId', args.stripeCheckoutSessionId))
          .unique()
      : null
    const byPayment = args.stripePaymentIntentId
      ? await ctx.db.query('budgetTopUps')
          .withIndex('by_paymentIntentId', (q) => q.eq('stripePaymentIntentId', args.stripePaymentIntentId))
          .unique()
      : null
    const existing = byCheckout ?? byPayment
    if (existing?.billingAccountId && existing.billingAccountId !== args.billingAccountId) {
      throw new Error('top_up_billing_account_conflict')
    }
    if (existing && existing.amountCents !== args.amountCents) throw new Error('top_up_amount_conflict')
    const granted = !existing || existing.status !== 'succeeded'
    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, { billingAccountId: args.billingAccountId, status: 'succeeded', updatedAt: now })
    } else {
      await ctx.db.insert('budgetTopUps', {
        userId: args.actorUserId,
        billingAccountId: args.billingAccountId,
        amountCents: args.amountCents,
        source: 'manual',
        status: 'succeeded',
        billingPeriodStart: now,
        createdAt: now,
        updatedAt: now,
        ...(args.stripeCheckoutSessionId ? { stripeCheckoutSessionId: args.stripeCheckoutSessionId } : {}),
        ...(args.stripeCustomerId ? { stripeCustomerId: args.stripeCustomerId } : {}),
        ...(args.stripePaymentIntentId ? { stripePaymentIntentId: args.stripePaymentIntentId } : {}),
      })
    }
    if (granted) {
      const balance = await ensureEmptyBalance(ctx, args.billingAccountId)
      const amountMicros = args.amountCents * 10_000
      await ctx.db.patch(balance._id, {
        topUpPurchasedMicros: balance.topUpPurchasedMicros + amountMicros,
        topUpBalanceMicros: balance.topUpBalanceMicros + amountMicros,
        updatedAt: now,
        version: balance.version + 1,
      })
    }
    return { granted }
  },
})
