import { v } from 'convex/values'
import { workspaceExecutionAccess } from '@/shared/billing/execution-access'
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { canceledPlanCreditPatch, ensureEmptyBalance, requireCanonicalBalanceAccount } from './accountModel'

async function requireCanonicalAccountById(ctx: { db: MutationCtx['db'] }, billingAccountId: string) {
  const account = await ctx.db.query('billingAccounts')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
    .unique()
  requireCanonicalBalanceAccount(account)
}

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
  autoTopUpMonthlyLimitCents: v.optional(v.number()),
  /** Automatic top-ups charged (pending or succeeded) since the current period started. */
  autoTopUpSpentThisPeriodCents: v.number(),
  /** An automatic top-up is still waiting on Stripe (for example 3-D Secure); no second one starts meanwhile. */
  autoTopUpPending: v.boolean(),
  offSessionConsentAt: v.optional(v.number()),
  currentPeriodStart: v.optional(v.number()),
  currentPeriodEnd: v.optional(v.number()),
  paidPeriodStart: v.optional(v.number()),
  paidPeriodEnd: v.optional(v.number()),
})

/** Automatic top-ups charged or being charged (pending or succeeded) since `since`, and whether one is pending. */
async function autoTopUpsSince(ctx: QueryCtx, billingAccountId: string, since: number | undefined) {
  const start = since ?? Date.now() - 31 * 24 * 60 * 60 * 1000
  const rows = (await ctx.db.query('budgetTopUps')
    .withIndex('by_billingAccountId_createdAt', (q) => q.eq('billingAccountId', billingAccountId).gte('createdAt', start))
    .collect())
    .filter((row) => row.source === 'auto' && (row.status === 'pending' || row.status === 'succeeded'))
  const intents = await ctx.db.query('billingAutoTopUpIntents')
    .withIndex('by_billingAccountId_createdAt', (q) => q.eq('billingAccountId', billingAccountId))
    .collect()
  const rowIntentKeys = new Set(rows.flatMap((row) => row.autoTopUpIntentKey ? [row.autoTopUpIntentKey] : []))
  const pendingClaims = intents.filter((intent) => intent.state === 'pending')
  const pendingClaimCents = pendingClaims
    .filter((intent) => !rowIntentKeys.has(intent.intentKey))
    .reduce((sum, intent) => sum + intent.amountCents, 0)
  return {
    spentCents: rows.reduce((sum, row) => sum + row.amountCents, 0) + pendingClaimCents,
    pending: rows.some((row) => row.status === 'pending') || pendingClaims.length > 0,
  }
}

export const getPendingAutoTopUpIntentByServer = query({
  args: { billingAccountId: v.string(), serverSecret: v.string() },
  returns: v.union(v.object({
    intentKey: v.string(),
    idempotencyKey: v.string(),
    actorUserId: v.string(),
    workspaceId: v.string(),
    amountCents: v.number(),
    currentPeriodStart: v.optional(v.number()),
    consentAt: v.number(),
    paymentMethodId: v.string(),
    customerId: v.string(),
    createdAt: v.number(),
    stripePaymentIntentId: v.optional(v.string()),
  }), v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const pending = (await ctx.db.query('billingAutoTopUpIntents')
      .withIndex('by_billingAccountId_createdAt', q => q.eq('billingAccountId', args.billingAccountId))
      .collect())
      .filter(intent => intent.state === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!pending) return null
    return {
      intentKey: pending.intentKey,
      idempotencyKey: pending.idempotencyKey,
      actorUserId: pending.actorUserId,
      workspaceId: pending.workspaceId,
      amountCents: pending.amountCents,
      ...(pending.currentPeriodStart === undefined ? {} : { currentPeriodStart: pending.currentPeriodStart }),
      consentAt: pending.consentAt,
      paymentMethodId: pending.paymentMethodId,
      customerId: pending.customerId,
      createdAt: pending.createdAt,
      ...(pending.stripePaymentIntentId ? { stripePaymentIntentId: pending.stripePaymentIntentId } : {}),
    }
  },
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
      ...(row.autoTopUpMonthlyLimitCents === undefined ? {} : { autoTopUpMonthlyLimitCents: row.autoTopUpMonthlyLimitCents }),
      ...(await autoTopUpsSince(ctx, row.billingAccountId, row.currentPeriodStart).then((auto) => ({
        autoTopUpSpentThisPeriodCents: auto.spentCents,
        autoTopUpPending: auto.pending,
      }))),
      ...(row.offSessionConsentAt === undefined ? {} : { offSessionConsentAt: row.offSessionConsentAt }),
      ...(row.currentPeriodStart === undefined ? {} : { currentPeriodStart: row.currentPeriodStart }),
      ...(row.currentPeriodEnd === undefined ? {} : { currentPeriodEnd: row.currentPeriodEnd }),
      ...(row.paidPeriodStart === undefined ? {} : { paidPeriodStart: row.paidPeriodStart }),
      ...(row.paidPeriodEnd === undefined ? {} : { paidPeriodEnd: row.paidPeriodEnd }),
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
    paidPeriodStart: v.optional(v.number()),
    paidPeriodEnd: v.optional(v.number()),
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
      ...(subscription?.paidPeriodStart === undefined ? {} : { paidPeriodStart: subscription.paidPeriodStart }),
      ...(subscription?.paidPeriodEnd === undefined ? {} : { paidPeriodEnd: subscription.paidPeriodEnd }),
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
    autoTopUpMonthlyLimitCents: v.optional(v.number()),
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
    requireCanonicalBalanceAccount(account)
    if (account.status !== 'active') throw new Error('billing_account_inactive')
    const existing = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
      .unique()
    if (
      existing?.providerEventCreatedAt !== undefined
      && args.providerEventCreatedAt !== undefined
      && args.providerEventCreatedAt < existing.providerEventCreatedAt
    ) return { billingAccountId, applied: false }
    if (args.status !== 'canceled' && existing?.currentPeriodStart !== undefined && args.currentPeriodStart !== undefined
      && args.stripeSubscriptionId === existing.providerSubscriptionId && args.currentPeriodStart < existing.currentPeriodStart) return { billingAccountId, applied: false }
    if (existing?.providerSubscriptionId && args.stripeSubscriptionId && args.stripeSubscriptionId !== existing.providerSubscriptionId
      && (args.status === 'canceled' || existing.status !== 'canceled')) return { billingAccountId, applied: false }
    if (existing?.status === 'canceled' && args.status === 'active' && args.stripeSubscriptionId === existing.providerSubscriptionId) {
      return { billingAccountId, applied: false }
    }
    const now = Date.now()
    const isCancellation = args.status === 'canceled' && args.planKind === 'free' && args.planAmountCents === 0
    const planKind = args.planKind ?? existing?.planKind ?? 'free'
    const planAmountCents = Math.max(0, args.planAmountCents ?? existing?.planAmountCents ?? 0)
    const value = {
      billingAccountId,
      provider: args.provider ?? existing?.provider ?? 'stripe',
      ...(args.stripeSubscriptionId && args.stripeSubscriptionId !== existing?.providerSubscriptionId
        ? { paidPeriodStart: undefined, paidPeriodEnd: undefined, paidInvoiceId: undefined } : {}),
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
      autoTopUpEnabled: isCancellation ? false : args.autoTopUpEnabled ?? existing?.autoTopUpEnabled ?? false,
      autoTopUpAmountCents: args.autoTopUpAmountCents ?? existing?.autoTopUpAmountCents ?? 0,
      ...(args.autoTopUpMonthlyLimitCents ?? existing?.autoTopUpMonthlyLimitCents
        ? { autoTopUpMonthlyLimitCents: args.autoTopUpMonthlyLimitCents ?? existing?.autoTopUpMonthlyLimitCents }
        : {}),
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
    if (isCancellation) await ctx.db.patch(balance._id, {
      ...(await canceledPlanCreditPatch(ctx, balance, balance.usedMicros, balance.reservedMicros)),
      updatedAt: now, version: balance.version + 1,
    })
    return { billingAccountId, applied: true }
  },
})

const paidPeriodArgs = {
  billingAccountId: v.string(),
  stripeCustomerId: v.string(),
  stripeSubscriptionId: v.string(),
  paidInvoiceId: v.string(),
  paidPeriodStart: v.number(),
  paidPeriodEnd: v.number(),
  amountCents: v.number(),
}

async function fundPaidPeriod(ctx: MutationCtx, args: {
  billingAccountId: string; stripeCustomerId: string; stripeSubscriptionId: string
  paidInvoiceId: string; paidPeriodStart: number; paidPeriodEnd: number; amountCents: number
}) {
  if (!args.paidInvoiceId || !Number.isSafeInteger(args.amountCents) || args.amountCents < 800 || args.amountCents > 50_000
    || !Number.isSafeInteger(args.paidPeriodStart) || !Number.isSafeInteger(args.paidPeriodEnd)
    || args.paidPeriodStart <= 0 || args.paidPeriodEnd <= args.paidPeriodStart) throw new Error('invalid_paid_period')
  const account = await ctx.db.query('billingAccounts')
    .withIndex('by_billingAccountId', q => q.eq('billingAccountId', args.billingAccountId)).unique()
  requireCanonicalBalanceAccount(account)
  if (!account || account.scope !== 'workspace' || account.status !== 'active') throw new Error('billing_account_inactive')
  const subscription = await ctx.db.query('billingAccountSubscriptions')
    .withIndex('by_billingAccountId', q => q.eq('billingAccountId', args.billingAccountId)).unique()
  if (!subscription) throw new Error('paid_period_subscription_missing')
  if (subscription.providerSubscriptionId !== args.stripeSubscriptionId) return { applied: false }
  if (subscription.providerCustomerId !== args.stripeCustomerId) throw new Error('paid_period_customer_mismatch')
  if (subscription.status !== 'active' || subscription.planKind !== 'paid'
    || subscription.planAmountCents !== args.amountCents
    || subscription.currentPeriodStart !== args.paidPeriodStart || subscription.currentPeriodEnd !== args.paidPeriodEnd
    || (subscription.paidPeriodStart !== undefined && subscription.paidPeriodStart >= args.paidPeriodStart)) return { applied: false }
  const balance = await ensureEmptyBalance(ctx, args.billingAccountId)
  const renewal = subscription.paidPeriodStart !== undefined
  // Retry after legitimate reservations settle, without losing the webhook receipt.
  if (renewal && balance.reservedMicros > 0) throw new Error('billing_period_rollover_has_active_reservations')
  const includedMicros = args.amountCents * 10_000
  if (!renewal && balance.includedMicros !== 0 && balance.includedMicros !== includedMicros) {
    throw new Error('paid_period_requires_balance_reconciliation')
  }
  if (!renewal && balance.usedMicros + balance.reservedMicros > includedMicros + balance.institutionalGrantMicros + balance.topUpPurchasedMicros) {
    throw new Error('paid_period_requires_balance_reconciliation')
  }
  const now = Date.now()
  await ctx.db.patch(subscription._id, {
    paidInvoiceId: args.paidInvoiceId, paidPeriodStart: args.paidPeriodStart, paidPeriodEnd: args.paidPeriodEnd, updatedAt: now,
  })
  await ctx.db.patch(balance._id, {
    includedMicros, mode: 'budgeted',
    ...(renewal ? { usedMicros: 0, reservedMicros: 0, allowanceUsedMicros: 0, topUpPurchasedMicros: 0, topUpBalanceMicros: 0 } : {}),
    version: balance.version + 1, updatedAt: now,
  })
  return { applied: true }
}

export const fundPaidPeriodByServer = mutation({
  args: { ...paidPeriodArgs, serverSecret: v.string() },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => { requireServerSecret(args.serverSecret); return fundPaidPeriod(ctx, args) },
})

export const fundPaidPeriodInternal = internalMutation({
  args: paidPeriodArgs,
  returns: v.object({ applied: v.boolean() }),
  handler: fundPaidPeriod,
})

export const recordTopUpByServer = mutation({
  args: {
    actorUserId: v.string(),
    amountCents: v.number(),
    billingAccountId: v.string(),
    workspaceId: v.optional(v.string()),
    source: v.union(v.literal('manual'), v.literal('auto')),
    status: v.union(v.literal('pending'), v.literal('succeeded'), v.literal('failed'), v.literal('canceled')),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    autoTopUpIntentKey: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    serverSecret: v.string(),
  },
  returns: v.object({ id: v.string(), granted: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) throw new Error('invalid_top_up_amount')
    await requireCanonicalAccountById(ctx, args.billingAccountId)
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
    const byIntentKey = args.autoTopUpIntentKey
      ? await ctx.db.query('budgetTopUps')
          .withIndex('by_autoTopUpIntentKey', (q) => q.eq('autoTopUpIntentKey', args.autoTopUpIntentKey))
          .unique()
      : null
    const matches = [byCheckout, byPayment, byIntentKey].filter(Boolean)
    if (new Set(matches.map((row) => String(row!._id))).size > 1) throw new Error('top_up_provider_reference_conflict')
    const existing = byCheckout ?? byPayment ?? byIntentKey
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
        ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
        status: persistedStatus,
        updatedAt: now,
        ...(args.autoTopUpIntentKey ? { autoTopUpIntentKey: args.autoTopUpIntentKey } : {}),
        ...(args.stripePaymentIntentId ? { stripePaymentIntentId: args.stripePaymentIntentId } : {}),
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      })
    } else {
      const inserted = await ctx.db.insert('budgetTopUps', {
        userId: args.actorUserId,
        billingAccountId: args.billingAccountId,
        ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
        amountCents: args.amountCents,
        source: args.source,
        status: args.status,
        ...(args.autoTopUpIntentKey ? { autoTopUpIntentKey: args.autoTopUpIntentKey } : {}),
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
    if (args.autoTopUpIntentKey) {
      const claim = await ctx.db.query('billingAutoTopUpIntents')
        .withIndex('by_billingAccountId_intentKey', (q) => q
          .eq('billingAccountId', args.billingAccountId).eq('intentKey', args.autoTopUpIntentKey!))
        .unique()
      if (!claim) throw new Error('auto_top_up_intent_claim_missing')
      if (claim.amountCents !== args.amountCents) throw new Error('auto_top_up_intent_amount_mismatch')
      const nextState = claim.state === 'succeeded' || persistedStatus === 'succeeded'
        ? 'succeeded'
        : persistedStatus === 'failed' || persistedStatus === 'canceled' ? 'payment_failed' : 'pending'
      await ctx.db.patch(claim._id, {
        state: nextState,
        ...(args.stripePaymentIntentId ? { stripePaymentIntentId: args.stripePaymentIntentId } : {}),
        updatedAt: now,
      })
    } else if (args.stripePaymentIntentId) {
      const claim = await ctx.db.query('billingAutoTopUpIntents')
        .withIndex('by_paymentIntentId', (q) => q.eq('stripePaymentIntentId', args.stripePaymentIntentId))
        .unique()
      if (claim) {
        const nextState = claim.state === 'succeeded' || args.status === 'succeeded'
          ? 'succeeded'
          : args.status === 'failed' || args.status === 'canceled' ? 'payment_failed' : 'pending'
        await ctx.db.patch(claim._id, { state: nextState, updatedAt: now })
      }
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

export const claimAutoTopUpIntentByServer = mutation({
  args: {
    serverSecret: v.string(),
    actorUserId: v.string(),
    billingAccountId: v.string(),
    workspaceId: v.string(),
    intentKey: v.string(),
    idempotencyKey: v.string(),
    amountCents: v.number(),
    currentPeriodStart: v.optional(v.number()),
    consentAt: v.number(),
    paymentMethodId: v.string(),
    customerId: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal('claimed'), v.literal('pending'), v.literal('payment_failed'), v.literal('succeeded'),
      v.literal('disabled'), v.literal('missing_consent'), v.literal('missing_customer'),
      v.literal('missing_payment_method'), v.literal('monthly_limit_reached'), v.literal('authorization_changed'),
    ),
    idempotencyKey: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    customerId: v.optional(v.string()),
    paymentMethodId: v.optional(v.string()),
    amountCents: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!args.actorUserId.trim() || !args.workspaceId.trim() || !args.intentKey.trim()
      || !args.idempotencyKey.trim() || !Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) {
      throw new Error('invalid_auto_top_up_intent')
    }
    await requireCanonicalAccountById(ctx, args.billingAccountId)
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId))
      .unique()
    if (!account || account.scope !== 'workspace' || account.workspaceId !== args.workspaceId || account.status !== 'active') {
      return { status: 'authorization_changed' as const }
    }
    const plan = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId))
      .unique()
    if (!plan || plan.planKind !== 'paid' || plan.status !== 'active' || !plan.autoTopUpEnabled) return { status: 'disabled' as const }
    if (!workspaceExecutionAccess({ billingEnabled: true, accountStatus: account.status,
      subscription: plan, remainingCents: 0, checkBudget: false }).canExecute) {
      return { status: 'disabled' as const }
    }
    if (!plan.offSessionConsentAt || plan.offSessionConsentAt !== args.consentAt) {
      return { status: 'missing_consent' as const }
    }
    if (!plan.providerCustomerId || plan.providerCustomerId !== args.customerId) {
      return { status: 'missing_customer' as const }
    }
    if (!args.paymentMethodId.trim()) return { status: 'missing_payment_method' as const }
    if (plan.autoTopUpAmountCents !== args.amountCents || plan.currentPeriodStart !== args.currentPeriodStart) {
      return { status: 'authorization_changed' as const }
    }

    const existing = await ctx.db.query('billingAutoTopUpIntents')
      .withIndex('by_billingAccountId_intentKey', (q) => q
        .eq('billingAccountId', args.billingAccountId).eq('intentKey', args.intentKey))
      .unique()
    if (existing) {
      if (existing.amountCents !== args.amountCents || existing.customerId !== args.customerId
        || existing.paymentMethodId !== args.paymentMethodId || existing.consentAt !== args.consentAt
        || existing.currentPeriodStart !== args.currentPeriodStart) {
        return { status: 'authorization_changed' as const }
      }
      if (existing.state === 'payment_failed') return { status: 'payment_failed' as const }
      if (existing.state === 'succeeded') return { status: 'succeeded' as const }
      if (existing.stripePaymentIntentId) {
        return {
          status: 'pending' as const, stripePaymentIntentId: existing.stripePaymentIntentId,
          idempotencyKey: existing.idempotencyKey, actorUserId: existing.actorUserId,
          workspaceId: existing.workspaceId, customerId: existing.customerId,
          paymentMethodId: existing.paymentMethodId, amountCents: existing.amountCents,
        }
      }
      if (Date.now() - existing.createdAt >= 23 * 60 * 60 * 1000) {
        return {
          status: 'pending' as const, idempotencyKey: existing.idempotencyKey,
          actorUserId: existing.actorUserId, workspaceId: existing.workspaceId,
          customerId: existing.customerId, paymentMethodId: existing.paymentMethodId,
          amountCents: existing.amountCents,
        }
      }
      return {
        status: 'claimed' as const, idempotencyKey: existing.idempotencyKey,
        actorUserId: existing.actorUserId, workspaceId: existing.workspaceId,
        customerId: existing.customerId, paymentMethodId: existing.paymentMethodId,
        amountCents: existing.amountCents,
      }
    }

    const unresolved = (await ctx.db.query('billingAutoTopUpIntents')
      .withIndex('by_billingAccountId_createdAt', (q) => q.eq('billingAccountId', args.billingAccountId))
      .collect()).find((intent) => intent.state === 'pending')
    if (unresolved) {
      return {
        status: 'pending' as const, ...(unresolved.stripePaymentIntentId ? { stripePaymentIntentId: unresolved.stripePaymentIntentId } : {}),
        idempotencyKey: unresolved.idempotencyKey, actorUserId: unresolved.actorUserId,
        workspaceId: unresolved.workspaceId, customerId: unresolved.customerId,
        paymentMethodId: unresolved.paymentMethodId, amountCents: unresolved.amountCents,
      }
    }

    const recentIntents = await ctx.db.query('billingAutoTopUpIntents')
      .withIndex('by_billingAccountId_createdAt', (q) => q.eq('billingAccountId', args.billingAccountId))
      .order('desc')
      .take(100)
    const latchedFailure = recentIntents.find((intent) => intent.state === 'payment_failed'
      && intent.amountCents === args.amountCents
      && intent.consentAt === args.consentAt
      && intent.paymentMethodId === args.paymentMethodId
      && intent.customerId === args.customerId)
    if (latchedFailure) return { status: 'payment_failed' as const }

    const periodStart = args.currentPeriodStart ?? Date.now() - 31 * 24 * 60 * 60 * 1000
    const topUps = await ctx.db.query('budgetTopUps')
      .withIndex('by_billingAccountId_createdAt', (q) => q.eq('billingAccountId', args.billingAccountId).gte('createdAt', periodStart))
      .collect()
    const inPeriodAutoTopUps = topUps.filter((topUp) => topUp.source === 'auto'
      && (topUp.status === 'pending' || topUp.status === 'succeeded'))
    const countedIntentKeys = new Set(inPeriodAutoTopUps.flatMap((topUp) => topUp.autoTopUpIntentKey ? [topUp.autoTopUpIntentKey] : []))
    const intents = await ctx.db.query('billingAutoTopUpIntents')
      .withIndex('by_billingAccountId_createdAt', (q) => q.eq('billingAccountId', args.billingAccountId).gte('createdAt', periodStart))
      .collect()
    const unrecordedPendingCents = intents
      .filter((intent) => intent.state === 'pending' && intent.currentPeriodStart === args.currentPeriodStart
        && !countedIntentKeys.has(intent.intentKey))
      .reduce((sum, intent) => sum + intent.amountCents, 0)
    const spentCents = inPeriodAutoTopUps.reduce((sum, topUp) => sum + topUp.amountCents, 0)
    if (plan.autoTopUpMonthlyLimitCents === undefined
      || spentCents + unrecordedPendingCents + args.amountCents > plan.autoTopUpMonthlyLimitCents) {
      return { status: 'monthly_limit_reached' as const }
    }

    const now = Date.now()
    await ctx.db.insert('billingAutoTopUpIntents', {
      billingAccountId: args.billingAccountId,
      actorUserId: args.actorUserId,
      workspaceId: args.workspaceId,
      intentKey: args.intentKey,
      idempotencyKey: args.idempotencyKey,
      amountCents: args.amountCents,
      ...(args.currentPeriodStart !== undefined ? { currentPeriodStart: args.currentPeriodStart } : {}),
      consentAt: args.consentAt,
      paymentMethodId: args.paymentMethodId,
      customerId: args.customerId,
      state: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    return {
      status: 'claimed' as const, idempotencyKey: args.idempotencyKey,
      actorUserId: args.actorUserId, workspaceId: args.workspaceId,
      customerId: args.customerId, paymentMethodId: args.paymentMethodId,
      amountCents: args.amountCents,
    }
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
    await requireCanonicalAccountById(ctx, args.billingAccountId)
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
    requireCanonicalBalanceAccount(account)
    if (!account || account.status !== 'active') throw new Error('billing_account_inactive')
    const existing = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', args.billingAccountId))
      .unique()
    if (existing?.providerEventCreatedAt !== undefined
      && args.providerEventCreatedAt < existing.providerEventCreatedAt) return { applied: false }
    if (args.status !== 'canceled' && existing?.currentPeriodStart !== undefined && args.currentPeriodStart !== undefined
      && args.stripeSubscriptionId === existing.providerSubscriptionId && args.currentPeriodStart < existing.currentPeriodStart) return { applied: false }
    if (existing?.providerSubscriptionId && args.stripeSubscriptionId && args.stripeSubscriptionId !== existing.providerSubscriptionId
      && (args.status === 'canceled' || existing.status !== 'canceled')) return { applied: false }
    if (existing?.status === 'canceled' && args.status === 'active' && args.stripeSubscriptionId === existing.providerSubscriptionId) return { applied: false }
    const now = Date.now()
    const isCancellation = args.status === 'canceled' && args.planKind === 'free' && args.planAmountCents === 0
    const value = {
      billingAccountId: args.billingAccountId,
      provider: 'stripe',
      ...(args.stripeSubscriptionId && args.stripeSubscriptionId !== existing?.providerSubscriptionId
        ? { paidPeriodStart: undefined, paidPeriodEnd: undefined, paidInvoiceId: undefined } : {}),
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
      autoTopUpEnabled: isCancellation ? false : args.autoTopUpEnabled ?? existing?.autoTopUpEnabled ?? false,
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
    if (isCancellation) await ctx.db.patch(balance._id, {
      ...(await canceledPlanCreditPatch(ctx, balance, balance.usedMicros, balance.reservedMicros)),
      updatedAt: now, version: balance.version + 1,
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
    await requireCanonicalAccountById(ctx, args.billingAccountId)
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

/**
 * The workspace billing account that owns a Stripe subscription or customer. Webhooks use it when the Stripe object's
 * metadata does not name a billing account (subscriptions started before plans moved to workspaces name the person).
 */
export const workspaceAccountByProviderReferenceInternal = internalQuery({
  args: { stripeCustomerId: v.optional(v.string()), stripeSubscriptionId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<string | null> => {
    const rows = [
      args.stripeSubscriptionId
        ? await ctx.db.query('billingAccountSubscriptions').withIndex('by_providerSubscriptionId', (q) => q.eq('providerSubscriptionId', args.stripeSubscriptionId)).first()
        : null,
      args.stripeCustomerId
        ? await ctx.db.query('billingAccountSubscriptions').withIndex('by_providerCustomerId', (q) => q.eq('providerCustomerId', args.stripeCustomerId)).first()
        : null,
    ]
    for (const row of rows) {
      if (!row) continue
      const account = await ctx.db.query('billingAccounts').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', row.billingAccountId)).unique()
      if (account?.scope === 'workspace') return account.billingAccountId
    }
    return null
  },
})
