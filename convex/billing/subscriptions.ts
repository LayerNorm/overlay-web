import { v } from 'convex/values'
import { mutation, query, internalMutation, internalQuery, type MutationCtx } from '../_generated/server'
import { getVerifiedAccessTokenClaims, requireAccessToken, requireServerSecret } from '../lib/auth'
import {
  DEFAULT_MARKUP_BASIS_POINTS,
  derivePlanAmountCents,
  derivePlanKind,
  planAmountCentsToQuantity,
} from '../../src/shared/billing/billing-pricing'
import { syncPersonalBillingShadows } from './accountMigration'
import { ensurePersonalBillingAccount } from './accountModel'
import { resolveStripeEntitlementFields } from './lib/stripeOverlaySubscription'

// Minimum gap between two period-start timestamps that counts as a genuine
// rollover. Anything smaller is treated as the same billing cycle (repeated
// webhook delivery, clock skew, Stripe internal updates). Using a meaningful
// gap prevents a same-day replay from re-resetting creditsUsed to 0.
const PERIOD_ROLLOVER_MIN_GAP_MS = 60 * 60 * 1000 // 1 hour

// Returns true if the new period start represents a different billing cycle
// than what is currently stored, indicating credits should be reset.
function isPeriodRollover(existingPeriodStart: number | undefined, newPeriodStart: number): boolean {
  if (!existingPeriodStart || existingPeriodStart === 0) return false
  if (!Number.isFinite(newPeriodStart) || newPeriodStart <= 0) return false
  // Only count forward movement of the period boundary beyond the min gap as a
  // rollover. Backward or near-equal timestamps are retries/replays.
  return newPeriodStart - existingPeriodStart >= PERIOD_ROLLOVER_MIN_GAP_MS
}

async function grantTopUpBalance(
  ctx: MutationCtx,
  subscription: {
    _id: Parameters<MutationCtx['db']['patch']>[0]
    userId: string
    currentPeriodStart?: number
    creditsUsed?: number
    allowanceUsedCents?: number
    topUpPurchasedCents?: number
    topUpBalanceCents?: number
    planAmountCents?: number
    institutionalGrantCents?: number
    planKind?: 'free' | 'paid'
    tier: 'free' | 'pro' | 'max'
  },
  amountCents: number,
): Promise<void> {
  const allowanceTotal = derivePlanKind(subscription) === 'paid'
    ? derivePlanAmountCents(subscription) + (subscription.institutionalGrantCents ?? 0)
    : 0
  const creditsUsed = Math.max(0, subscription.creditsUsed ?? 0)
  const allowanceUsed = subscription.allowanceUsedCents ?? Math.min(creditsUsed, allowanceTotal)
  const historical = subscription.currentPeriodStart
    ? await ctx.db
        .query('budgetTopUps')
        .withIndex('by_userId_billingPeriodStart', (q) =>
          q.eq('userId', subscription.userId).eq('billingPeriodStart', subscription.currentPeriodStart!),
        )
        .collect()
    : []
  const historicalPurchased = historical.reduce(
    (sum, row) => row.status === 'succeeded' ? sum + Math.max(0, row.amountCents) : sum,
    0,
  )
  const purchased = subscription.topUpPurchasedCents ?? Math.max(0, historicalPurchased - amountCents)
  const balance = subscription.topUpBalanceCents ?? Math.max(0, purchased - (creditsUsed - allowanceUsed))
  await ctx.db.patch(subscription._id, {
    allowanceUsedCents: allowanceUsed,
    topUpPurchasedCents: purchased + amountCents,
    topUpBalanceCents: balance + amountCents,
  })
}

async function topUpBalanceForRollover(
  ctx: MutationCtx,
  subscription: {
    userId: string
    currentPeriodStart?: number
    creditsUsed?: number
    allowanceUsedCents?: number
    topUpPurchasedCents?: number
    topUpBalanceCents?: number
    planAmountCents?: number
    institutionalGrantCents?: number
    planKind?: 'free' | 'paid'
    tier: 'free' | 'pro' | 'max'
  },
): Promise<number> {
  if (subscription.topUpBalanceCents !== undefined) return subscription.topUpBalanceCents
  const rows = subscription.currentPeriodStart
    ? await ctx.db
        .query('budgetTopUps')
        .withIndex('by_userId_billingPeriodStart', (q) =>
          q.eq('userId', subscription.userId).eq('billingPeriodStart', subscription.currentPeriodStart!),
        )
        .collect()
    : []
  const purchased = subscription.topUpPurchasedCents ?? rows.reduce(
    (sum, row) => row.status === 'succeeded' ? sum + Math.max(0, row.amountCents) : sum,
    0,
  )
  const allowanceTotal = derivePlanKind(subscription) === 'paid'
    ? derivePlanAmountCents(subscription) + (subscription.institutionalGrantCents ?? 0)
    : 0
  const allowanceUsed = subscription.allowanceUsedCents ?? Math.min(
    Math.max(0, subscription.creditsUsed ?? 0),
    allowanceTotal,
  )
  return Math.max(0, purchased - Math.max(0, (subscription.creditsUsed ?? 0) - allowanceUsed))
}

async function rebalanceUsageForAllowance(
  ctx: MutationCtx,
  subscription: {
    userId: string
    currentPeriodStart?: number
    creditsUsed?: number
    allowanceUsedCents?: number
    topUpPurchasedCents?: number
    planAmountCents?: number
    institutionalGrantCents?: number
    planKind?: 'free' | 'paid'
    tier: 'free' | 'pro' | 'max'
  },
  nextPlan: {
    planAmountCents?: number
    planKind?: 'free' | 'paid'
    tier: 'free' | 'pro' | 'max'
  },
): Promise<{
  allowanceUsedCents: number
  topUpBalanceCents: number
  topUpPurchasedCents: number
}> {
  const rows = subscription.currentPeriodStart
    ? await ctx.db
        .query('budgetTopUps')
        .withIndex('by_userId_billingPeriodStart', (q) =>
          q.eq('userId', subscription.userId).eq('billingPeriodStart', subscription.currentPeriodStart!),
        )
        .collect()
    : []
  const topUpPurchasedCents = subscription.topUpPurchasedCents ?? rows.reduce(
    (sum, row) => row.status === 'succeeded' ? sum + Math.max(0, row.amountCents) : sum,
    0,
  )
  const allowanceTotal = derivePlanKind(nextPlan) === 'paid'
    ? derivePlanAmountCents(nextPlan) + (subscription.institutionalGrantCents ?? 0)
    : 0
  const creditsUsed = Math.max(0, subscription.creditsUsed ?? 0)
  const allowanceUsedCents = Math.min(creditsUsed, allowanceTotal)
  const topUpSpent = Math.max(0, creditsUsed - allowanceUsedCents)
  if (topUpSpent > topUpPurchasedCents + 0.000001) {
    throw new Error('Subscription change would remove already consumed or reserved credits')
  }
  return {
    allowanceUsedCents,
    topUpBalanceCents: Math.max(0, topUpPurchasedCents - topUpSpent),
    topUpPurchasedCents,
  }
}

function defaultPlanMetadata(args: {
  tier?: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  planVersion?: 'fixed_v1' | 'variable_v2'
  planAmountCents?: number
  stripePriceId?: string
  stripeQuantity?: number
  markupBasisPoints?: number
}) {
  const tier = args.tier ?? 'free'
  const planKind = args.planKind ?? derivePlanKind({ tier })
  const planAmountCents = args.planAmountCents ?? derivePlanAmountCents({ tier, planKind })
  return {
    planKind,
    planVersion: args.planVersion ?? (planKind === 'free' ? 'variable_v2' : 'variable_v2'),
    planAmountCents,
    stripePriceId: args.stripePriceId,
    stripeQuantity:
      args.stripeQuantity ??
      (planKind === 'paid' && planAmountCents > 0 ? planAmountCentsToQuantity(planAmountCents) : undefined),
    markupBasisPoints: args.markupBasisPoints ?? DEFAULT_MARKUP_BASIS_POINTS,
  }
}

// Get subscription by userId
export const getByUserId = query({
  args: { accessToken: v.string(), userId: v.string() },
  handler: async (ctx, { accessToken, userId }) => {
    try {
      await requireAccessToken(accessToken, userId)
    } catch {
      return null
    }
    return await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
  }
})

// Internal query for server-side ownership checks (used by stripe.ts actions)
export const getByUserIdInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
  }
})

export const getByUserIdByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)
    return await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
  },
})

export const listAllByServer = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, { serverSecret }) => {
    requireServerSecret(serverSecret)
    return await ctx.db.query('subscriptions').collect()
  },
})

// Get subscription by email (for cross-installation sync)
export const getByEmail = query({
  args: { accessToken: v.string(), email: v.string() },
  handler: async (ctx, { accessToken, email }) => {
    const claims = await getVerifiedAccessTokenClaims(accessToken)
    if (!claims) return null
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
    return subscription?.userId === claims.sub ? subscription : null
  }
})

// Get subscription by Stripe customer ID (for webhook lookups — internal only)
export const getByStripeCustomerId = query({
  args: { accessToken: v.string(), stripeCustomerId: v.string() },
  handler: async (ctx, { accessToken, stripeCustomerId }) => {
    const claims = await getVerifiedAccessTokenClaims(accessToken)
    if (!claims) return null
    const subscription = await ctx.db
      .query('subscriptions')
      .filter((q) => q.eq(q.field('stripeCustomerId'), stripeCustomerId))
      .first()
    return subscription?.userId === claims.sub ? subscription : null
  }
})

// Upsert subscription — requires server secret (called from authenticated Next.js routes).
// On period rollover (new currentPeriodStart differs from stored), creditsUsed is reset to 0.
export const upsertSubscription = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    stripeQuantity: v.optional(v.number()),
    tier: v.optional(v.union(v.literal('free'), v.literal('pro'), v.literal('max'))),
    planKind: v.optional(v.union(v.literal('free'), v.literal('paid'))),
    planVersion: v.optional(v.union(v.literal('fixed_v1'), v.literal('variable_v2'))),
    planAmountCents: v.optional(v.number()),
    markupBasisPoints: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal('active'),
        v.literal('canceled'),
        v.literal('past_due'),
        v.literal('trialing')
      )
    ),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    autoTopUpEnabled: v.optional(v.boolean()),
    autoTopUpAmountCents: v.optional(v.number()),
    offSessionConsentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const billingAccount = await ensurePersonalBillingAccount(ctx, args.userId)

    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()

    if (existing) {
      const updateData: Record<string, unknown> = { billingAccountId: billingAccount.billingAccountId }
      if (args.email !== undefined) updateData.email = args.email
      if (args.name !== undefined) updateData.name = args.name
      if (args.stripeCustomerId !== undefined) updateData.stripeCustomerId = args.stripeCustomerId
      if (args.stripeSubscriptionId !== undefined) updateData.stripeSubscriptionId = args.stripeSubscriptionId
      if (args.tier !== undefined) updateData.tier = args.tier
      if (args.planKind !== undefined) updateData.planKind = args.planKind
      if (args.planVersion !== undefined) updateData.planVersion = args.planVersion
      if (args.planAmountCents !== undefined) updateData.planAmountCents = args.planAmountCents
      if (args.markupBasisPoints !== undefined) updateData.markupBasisPoints = args.markupBasisPoints
      if (args.stripePriceId !== undefined) updateData.stripePriceId = args.stripePriceId
      if (args.stripeQuantity !== undefined) updateData.stripeQuantity = args.stripeQuantity
      if (args.status !== undefined) updateData.status = args.status
      if (args.cancelAtPeriodEnd !== undefined) updateData.cancelAtPeriodEnd = args.cancelAtPeriodEnd
      if (args.currentPeriodStart !== undefined) updateData.currentPeriodStart = args.currentPeriodStart
      if (args.currentPeriodEnd !== undefined) updateData.currentPeriodEnd = args.currentPeriodEnd
      if (args.autoTopUpEnabled !== undefined) updateData.autoTopUpEnabled = args.autoTopUpEnabled
      if (args.autoTopUpAmountCents !== undefined) updateData.autoTopUpAmountCents = args.autoTopUpAmountCents
      if (args.offSessionConsentAt !== undefined) updateData.offSessionConsentAt = args.offSessionConsentAt

      const nextTier = args.tier ?? existing.tier
      const nextPlanMetadata = defaultPlanMetadata({
        tier: nextTier,
        planKind: args.planKind ?? existing.planKind,
        planVersion: args.planVersion ?? existing.planVersion,
        planAmountCents: args.planAmountCents ?? existing.planAmountCents ?? derivePlanAmountCents(existing),
        stripePriceId: args.stripePriceId ?? existing.stripePriceId,
        stripeQuantity: args.stripeQuantity ?? existing.stripeQuantity,
        markupBasisPoints: args.markupBasisPoints ?? existing.markupBasisPoints,
      })
      Object.assign(updateData, nextPlanMetadata)

      // Reset credits when the billing period rolls over
      if (
        args.currentPeriodStart !== undefined &&
        isPeriodRollover(existing.currentPeriodStart, args.currentPeriodStart)
      ) {
        const activeReservations = await ctx.db
          .query('budgetReservations')
          .withIndex('by_userId_createdAt', (q) => q.eq('userId', args.userId))
          .collect()
        if (activeReservations.some((row) => row.status === 'reserved' || row.status === 'reconcile_required')) {
          throw new Error('Cannot roll over a usage period while reservations are active')
        }
        const topUpBalanceCents = await topUpBalanceForRollover(ctx, existing)
        updateData.creditsUsed = 0
        updateData.allowanceUsedCents = 0
        updateData.topUpPurchasedCents = topUpBalanceCents
        updateData.topUpBalanceCents = topUpBalanceCents
      } else {
        Object.assign(updateData, await rebalanceUsageForAllowance(ctx, existing, {
          tier: nextTier,
          planKind: nextPlanMetadata.planKind,
          planAmountCents: nextPlanMetadata.planAmountCents,
        }))
      }

      await ctx.db.patch(existing._id, updateData)
      await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
      return existing._id
    } else {
      const subscriptionId = await ctx.db.insert('subscriptions', {
        userId: args.userId,
        billingAccountId: billingAccount.billingAccountId,
        email: args.email,
        name: args.name,
        stripeCustomerId: args.stripeCustomerId || '',
        stripeSubscriptionId: args.stripeSubscriptionId || '',
        tier: args.tier || 'free',
        ...defaultPlanMetadata({
          tier: args.tier,
          planKind: args.planKind,
          planVersion: args.planVersion,
          planAmountCents: args.planAmountCents,
          stripePriceId: args.stripePriceId,
          stripeQuantity: args.stripeQuantity,
          markupBasisPoints: args.markupBasisPoints,
        }),
        status: args.status || 'active',
        cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
        currentPeriodStart: args.currentPeriodStart || now,
        currentPeriodEnd: args.currentPeriodEnd || now + thirtyDays,
        creditsUsed: 0,
        allowanceUsedCents: 0,
        topUpPurchasedCents: 0,
        topUpBalanceCents: 0,
        overlayStorageBytesUsed: 0,
        autoTopUpEnabled: args.autoTopUpEnabled ?? false,
        autoTopUpAmountCents: args.autoTopUpAmountCents,
        offSessionConsentAt: args.offSessionConsentAt,
      })
      await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
      return subscriptionId
    }
  }
})

// Update subscription status — internal only
export const updateStatus = internalMutation({
  args: {
    userId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('canceled'),
      v.literal('past_due'),
      v.literal('trialing')
    )
  },
  handler: async (ctx, { userId, status }) => {
    const billingAccount = await ensurePersonalBillingAccount(ctx, userId)
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    if (subscription) {
      const patch: Record<string, unknown> = {
        status,
        billingAccountId: billingAccount.billingAccountId,
        cancelAtPeriodEnd: false,
      }
      if (status === 'canceled') {
        patch.tier = 'free'
        patch.planKind = 'free'
        patch.planAmountCents = 0
        patch.stripeQuantity = undefined
      }
      await ctx.db.patch(subscription._id, patch)
      await syncPersonalBillingShadows(ctx, userId, billingAccount.billingAccountId)
      return { success: true }
    }

    return { success: false, error: 'Subscription not found' }
  }
})

// Downgrade user to free tier — requires server secret
export const downgradeToFree = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string()
  },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)

    const billingAccount = await ensurePersonalBillingAccount(ctx, userId)

    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    if (subscription) {
      const now = Date.now()
      const activeReservations = await ctx.db
        .query('budgetReservations')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
        .collect()
      if (activeReservations.some((row) => row.status === 'reserved' || row.status === 'reconcile_required')) {
        throw new Error('Cannot downgrade while usage reservations are active')
      }
      const topUpBalanceCents = await topUpBalanceForRollover(ctx, subscription)
      await ctx.db.patch(subscription._id, {
        billingAccountId: billingAccount.billingAccountId,
        tier: 'free',
        planKind: 'free',
        planVersion: 'variable_v2',
        planAmountCents: 0,
        stripeQuantity: undefined,
        status: 'canceled',
        creditsUsed: 0,
        allowanceUsedCents: 0,
        topUpPurchasedCents: topUpBalanceCents,
        topUpBalanceCents,
        currentPeriodStart: now,
        currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000
      })
      await syncPersonalBillingShadows(ctx, userId, billingAccount.billingAccountId)
      return { success: true }
    }

    return { success: false, error: 'Subscription not found' }
  }
})

// Reset daily usage — internal only (called by scheduled job)
export const resetDailyUsage = internalMutation({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const usageRecords = await ctx.db
      .query('dailyUsage')
      .filter((q) => q.lt(q.field('date'), date))
      .collect()

    let deleted = 0
    for (const record of usageRecords) {
      await ctx.db.delete(record._id)
      deleted++
    }

    return { deleted }
  }
})

// Upsert from Stripe webhook data — internal only (called from http.ts webhook handler).
// Detects period rollover by comparing currentPeriodStart dates and resets creditsUsed to 0
// when the billing cycle changes (monthly renewal or plan upgrade/downgrade).
export const upsertFromStripeInternal = internalMutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    stripePriceId: v.optional(v.string()),
    stripeQuantity: v.optional(v.number()),
    tier: v.union(v.literal('free'), v.literal('pro'), v.literal('max')),
    planKind: v.optional(v.union(v.literal('free'), v.literal('paid'))),
    planVersion: v.optional(v.union(v.literal('fixed_v1'), v.literal('variable_v2'))),
    planAmountCents: v.optional(v.number()),
    markupBasisPoints: v.optional(v.number()),
    autoTopUpEnabled: v.optional(v.boolean()),
    autoTopUpAmountCents: v.optional(v.number()),
    offSessionConsentAt: v.optional(v.number()),
    status: v.union(
      v.literal('active'),
      v.literal('canceled'),
      v.literal('past_due'),
      v.literal('trialing')
    ),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number()
  },
  handler: async (ctx, args) => {
    const billingAccount = await ensurePersonalBillingAccount(ctx, args.userId)
    // Reject if this stripeCustomerId already maps to a different userId.
    // This prevents a single attacker's Stripe customer from being cross-linked
    // to multiple Convex accounts via manipulated webhook metadata.
    const existingByCustomer = await ctx.db
      .query('subscriptions')
      .withIndex('by_stripeCustomerId', (q) => q.eq('stripeCustomerId', args.stripeCustomerId))
      .first()
    if (existingByCustomer && existingByCustomer.userId !== args.userId) {
      console.error(
        `[Stripe Webhook] stripeCustomerId ${args.stripeCustomerId} already belongs to userId ${existingByCustomer.userId}, ` +
        `refusing to cross-link to ${args.userId}`,
      )
      throw new Error('stripeCustomerId already belongs to a different user')
    }

    const existing = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()

    const entitlement = resolveStripeEntitlementFields(args.status, {
      tier: args.tier,
      planKind: args.planKind,
      planVersion: args.planVersion,
      planAmountCents: args.planAmountCents,
      stripePriceId: args.stripePriceId,
      stripeQuantity: args.stripeQuantity,
      autoTopUpEnabled: args.autoTopUpEnabled,
      autoTopUpAmountCents: args.autoTopUpAmountCents,
      offSessionConsentAt: args.offSessionConsentAt,
    }, existing ? {
      tier: existing.tier,
      planKind: existing.planKind,
      planVersion: existing.planVersion,
      planAmountCents: existing.planAmountCents,
      stripePriceId: existing.stripePriceId,
      stripeQuantity: existing.stripeQuantity,
      autoTopUpEnabled: existing.autoTopUpEnabled,
      autoTopUpAmountCents: existing.autoTopUpAmountCents,
      offSessionConsentAt: existing.offSessionConsentAt,
    } : null)

    if (existing) {
      const periodRolled = (args.status === 'active' || args.status === 'trialing')
        && isPeriodRollover(existing.currentPeriodStart, args.currentPeriodStart)
      const subscriptionEnded = args.status === 'canceled'
      const resetUsage = periodRolled || subscriptionEnded
      let topUpBalanceCents = existing.topUpBalanceCents
      const nextPlanMetadata = defaultPlanMetadata({
        tier: entitlement.tier,
        planKind: entitlement.planKind,
        planVersion: entitlement.planVersion,
        planAmountCents: entitlement.planAmountCents,
        stripePriceId: entitlement.stripePriceId,
        stripeQuantity: entitlement.stripeQuantity,
        markupBasisPoints: args.markupBasisPoints ?? existing.markupBasisPoints,
      })
      if (resetUsage) {
        const activeReservations = await ctx.db
          .query('budgetReservations')
          .withIndex('by_userId_createdAt', (q) => q.eq('userId', args.userId))
          .collect()
        if (activeReservations.some((row) => row.status === 'reserved' || row.status === 'reconcile_required')) {
          throw new Error('Cannot roll over a usage period while reservations are active')
        }
        topUpBalanceCents = await topUpBalanceForRollover(ctx, existing)
      }
      const rebalancedUsage = resetUsage
        ? {
            allowanceUsedCents: 0,
            topUpPurchasedCents: topUpBalanceCents,
            topUpBalanceCents,
          }
        : await rebalanceUsageForAllowance(ctx, existing, {
            tier: entitlement.tier,
            planKind: nextPlanMetadata.planKind,
            planAmountCents: nextPlanMetadata.planAmountCents,
          })

      await ctx.db.patch(existing._id, {
        billingAccountId: billingAccount.billingAccountId,
        email: args.email,
        name: args.name,
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        tier: entitlement.tier,
        ...nextPlanMetadata,
        autoTopUpEnabled: entitlement.autoTopUpEnabled,
        autoTopUpAmountCents: entitlement.autoTopUpAmountCents,
        offSessionConsentAt: entitlement.offSessionConsentAt,
        status: args.status,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? existing.cancelAtPeriodEnd ?? false,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        // Reset credit counter on period rollover (monthly renewal or plan change)
        creditsUsed: resetUsage ? 0 : (existing.creditsUsed ?? 0),
        ...rebalancedUsage,
      })
      await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
      return existing._id
    } else {
      const subscriptionId = await ctx.db.insert('subscriptions', {
        userId: args.userId,
        billingAccountId: billingAccount.billingAccountId,
        email: args.email,
        name: args.name,
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        tier: entitlement.tier,
        ...defaultPlanMetadata({
          tier: entitlement.tier,
          planKind: entitlement.planKind,
          planVersion: entitlement.planVersion,
          planAmountCents: entitlement.planAmountCents,
          stripePriceId: entitlement.stripePriceId,
          stripeQuantity: entitlement.stripeQuantity,
          markupBasisPoints: args.markupBasisPoints,
        }),
        autoTopUpEnabled: entitlement.autoTopUpEnabled,
        autoTopUpAmountCents: entitlement.autoTopUpAmountCents,
        offSessionConsentAt: entitlement.offSessionConsentAt,
        status: args.status,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        creditsUsed: 0,
        allowanceUsedCents: 0,
        topUpPurchasedCents: 0,
        topUpBalanceCents: 0,
        overlayStorageBytesUsed: 0,
      })
      await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
      return subscriptionId
    }
  }
})

// One-time migration: backfills creditsUsed and period timestamps for all existing
// subscription rows that pre-date this schema change.
// Run via Convex CLI (handles auth automatically):
//   npx convex run subscriptions:migrateToCreditsOnSubscription --prod
export const migrateToCreditsOnSubscription = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allSubscriptions = await ctx.db.query('subscriptions').collect()
    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    let migrated = 0

    for (const sub of allSubscriptions) {
      const billingAccount = await ensurePersonalBillingAccount(ctx, sub.userId)
      const updates: Record<string, unknown> = {}
      updates.billingAccountId = billingAccount.billingAccountId

      // Ensure period timestamps are always populated
      const periodStart = sub.currentPeriodStart && sub.currentPeriodStart > 0
        ? sub.currentPeriodStart
        : now

      if (!sub.currentPeriodStart || sub.currentPeriodStart === 0) {
        updates.currentPeriodStart = periodStart
      }
      if (!sub.currentPeriodEnd || sub.currentPeriodEnd === 0) {
        updates.currentPeriodEnd = periodStart + thirtyDays
      }

      // Backfill creditsUsed from the corresponding tokenUsage row if available
      if (sub.creditsUsed === undefined || sub.creditsUsed === null) {
        const billingPeriodStart = new Date(periodStart).toISOString().split('T')[0]
        const tokenUsage = await ctx.db
          .query('tokenUsage')
          .withIndex('by_userId_period', (q) =>
            q.eq('userId', sub.userId).eq('billingPeriodStart', billingPeriodStart)
          )
          .first()

        updates.creditsUsed = tokenUsage?.creditsUsed ?? tokenUsage?.costAccrued ?? 0
      }

      if (sub.overlayStorageBytesUsed === undefined || sub.overlayStorageBytesUsed === null) {
        updates.overlayStorageBytesUsed = 0
      }
      if (!sub.planKind) {
        updates.planKind = derivePlanKind(sub)
      }
      if (!sub.planVersion) {
        updates.planVersion = sub.tier === 'free' ? 'variable_v2' : 'variable_v2'
      }
      if (sub.planAmountCents === undefined || sub.planAmountCents === null) {
        updates.planAmountCents = derivePlanAmountCents(sub)
      }
      if (sub.markupBasisPoints === undefined || sub.markupBasisPoints === null) {
        updates.markupBasisPoints = DEFAULT_MARKUP_BASIS_POINTS
      }
      if (sub.autoTopUpEnabled === undefined) {
        updates.autoTopUpEnabled = false
      }
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(sub._id, updates)
        migrated++
      }
      await syncPersonalBillingShadows(ctx, sub.userId, billingAccount.billingAccountId)
    }

    return { migrated, total: allSubscriptions.length }
  }
})

export const updateBillingPreferencesByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    autoTopUpEnabled: v.boolean(),
    topUpAmountCents: v.optional(v.number()),
    grantOffSessionConsent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)

    const billingAccount = await ensurePersonalBillingAccount(ctx, args.userId)

    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()

    if (!subscription) {
      return { success: false as const, error: 'Subscription not found' }
    }

    const patch: Record<string, unknown> = {
      billingAccountId: billingAccount.billingAccountId,
      autoTopUpEnabled: args.autoTopUpEnabled,
      autoTopUpAmountCents: args.topUpAmountCents ?? subscription.autoTopUpAmountCents ?? 1_000,
    }
    if (args.grantOffSessionConsent) {
      patch.offSessionConsentAt = Date.now()
    }

    await ctx.db.patch(subscription._id, patch)
    await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
    return { success: true as const }
  },
})

export const updateBillingPreferencesInternal = internalMutation({
  args: {
    userId: v.string(),
    autoTopUpEnabled: v.boolean(),
    topUpAmountCents: v.optional(v.number()),
    grantOffSessionConsent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const billingAccount = await ensurePersonalBillingAccount(ctx, args.userId)
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()

    if (!subscription) {
      return { success: false as const, error: 'Subscription not found' }
    }

    const patch: Record<string, unknown> = {
      billingAccountId: billingAccount.billingAccountId,
      autoTopUpEnabled: args.autoTopUpEnabled,
      autoTopUpAmountCents: args.topUpAmountCents ?? subscription.autoTopUpAmountCents ?? 1_000,
    }
    if (args.grantOffSessionConsent) {
      patch.offSessionConsentAt = Date.now()
    }

    await ctx.db.patch(subscription._id, patch)
    await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
    return { success: true as const }
  },
})

export const recordBudgetTopUpByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    amountCents: v.number(),
    source: v.union(v.literal('manual'), v.literal('auto')),
    stripeCustomerId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeInvoiceId: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('succeeded'), v.literal('failed'), v.literal('canceled')),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const billingAccount = await ensurePersonalBillingAccount(ctx, args.userId)
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()
    if (!subscription?.currentPeriodStart) {
      throw new Error('No billing period available for top-up')
    }
    const existingByPaymentIntent = args.stripePaymentIntentId
      ? await ctx.db
          .query('budgetTopUps')
          .withIndex('by_paymentIntentId', (q) => q.eq('stripePaymentIntentId', args.stripePaymentIntentId!))
          .first()
      : null
    const existingByCheckoutSession = args.stripeCheckoutSessionId
      ? await ctx.db
          .query('budgetTopUps')
          .withIndex('by_checkoutSessionId', (q) => q.eq('stripeCheckoutSessionId', args.stripeCheckoutSessionId!))
          .first()
      : null
    const existing = existingByPaymentIntent ?? existingByCheckoutSession
    if (existing && existing.userId !== args.userId) {
      throw new Error('Top-up provider reference already belongs to another user')
    }
    const normalizedAmount = Math.max(0, Math.round(args.amountCents))
    if (existing && existing.amountCents !== normalizedAmount) {
      throw new Error('Top-up provider reference was reused with a different amount')
    }
    const now = Date.now()
    const status = existing?.status === 'succeeded' ? 'succeeded' as const : args.status
    const grant = status === 'succeeded' && existing?.status !== 'succeeded'
    const payload = {
      userId: args.userId,
      billingAccountId: billingAccount.billingAccountId,
      stripeCustomerId: args.stripeCustomerId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeInvoiceId: args.stripeInvoiceId,
      billingPeriodStart: subscription.currentPeriodStart,
      billingPeriodEnd: subscription.currentPeriodEnd,
      amountCents: normalizedAmount,
      source: args.source,
      status,
      createdAt: now,
      updatedAt: now,
      errorMessage: args.errorMessage,
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...payload,
        createdAt: existing.createdAt,
        billingPeriodStart: existing.billingPeriodStart,
        billingPeriodEnd: existing.billingPeriodEnd,
      })
      if (grant) await grantTopUpBalance(ctx, subscription, normalizedAmount)
      await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
      return existing._id
    }
    const id = await ctx.db.insert('budgetTopUps', payload)
    if (grant) await grantTopUpBalance(ctx, subscription, normalizedAmount)
    await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
    return id
  },
})

export const recordBudgetTopUpInternal = internalMutation({
  args: {
    userId: v.string(),
    amountCents: v.number(),
    source: v.union(v.literal('manual'), v.literal('auto')),
    stripeCustomerId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeInvoiceId: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('succeeded'), v.literal('failed'), v.literal('canceled')),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const billingAccount = await ensurePersonalBillingAccount(ctx, args.userId)
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()
    if (!subscription?.currentPeriodStart) {
      throw new Error('No billing period available for top-up')
    }
    const existingByPaymentIntent = args.stripePaymentIntentId
      ? await ctx.db
          .query('budgetTopUps')
          .withIndex('by_paymentIntentId', (q) => q.eq('stripePaymentIntentId', args.stripePaymentIntentId!))
          .first()
      : null
    const existingByCheckoutSession = args.stripeCheckoutSessionId
      ? await ctx.db
          .query('budgetTopUps')
          .withIndex('by_checkoutSessionId', (q) => q.eq('stripeCheckoutSessionId', args.stripeCheckoutSessionId!))
          .first()
      : null
    const existing = existingByPaymentIntent ?? existingByCheckoutSession
    if (existing && existing.userId !== args.userId) {
      throw new Error('Top-up provider reference already belongs to another user')
    }
    const normalizedAmount = Math.max(0, Math.round(args.amountCents))
    if (existing && existing.amountCents !== normalizedAmount) {
      throw new Error('Top-up provider reference was reused with a different amount')
    }
    const now = Date.now()
    const status = existing?.status === 'succeeded' ? 'succeeded' as const : args.status
    const grant = status === 'succeeded' && existing?.status !== 'succeeded'
    const payload = {
      userId: args.userId,
      billingAccountId: billingAccount.billingAccountId,
      stripeCustomerId: args.stripeCustomerId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeInvoiceId: args.stripeInvoiceId,
      billingPeriodStart: subscription.currentPeriodStart,
      billingPeriodEnd: subscription.currentPeriodEnd,
      amountCents: normalizedAmount,
      source: args.source,
      status,
      createdAt: now,
      updatedAt: now,
      errorMessage: args.errorMessage,
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...payload,
        createdAt: existing.createdAt,
        billingPeriodStart: existing.billingPeriodStart,
        billingPeriodEnd: existing.billingPeriodEnd,
      })
      if (grant) await grantTopUpBalance(ctx, subscription, normalizedAmount)
      await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
      return existing._id
    }
    const id = await ctx.db.insert('budgetTopUps', payload)
    if (grant) await grantTopUpBalance(ctx, subscription, normalizedAmount)
    await syncPersonalBillingShadows(ctx, args.userId, billingAccount.billingAccountId)
    return id
  },
})

export const listBudgetTopUpsByServer = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db
      .query('budgetTopUps')
      .withIndex('by_userId_createdAt', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(20)
  },
})

/**
 * Reverses a succeeded top-up when Stripe reports a refund or lost dispute.
 * Debits the top-up balance so the user cannot spend the refunded credits.
 * If the user has already spent past the new balance, the balance goes to
 * zero (not negative) — the spend is already consumed, but further usage is
 * blocked until the user tops up again.
 */
export const reverseTopUpByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
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
    if (existing.userId !== args.userId) {
      throw new Error('Top-up provider reference belongs to another user')
    }
    if (existing.status !== 'succeeded') return { reversed: false }

    const alreadyRefunded = Math.max(0, existing.refundedAmountCents ?? 0)
    const maxRefundable = existing.amountCents - alreadyRefunded
    const refundAmount = Math.min(args.refundAmountCents, maxRefundable)
    if (refundAmount <= 0) return { reversed: false }

    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first()
    if (subscription) {
      const newBalance = Math.max(0, (subscription.topUpBalanceCents ?? 0) - refundAmount)
      const newPurchased = Math.max(0, (subscription.topUpPurchasedCents ?? 0) - refundAmount)
      await ctx.db.patch(subscription._id, {
        topUpBalanceCents: newBalance,
        topUpPurchasedCents: newPurchased,
      })
    }
    await ctx.db.patch(existing._id, {
      status: 'refunded',
      refundedAmountCents: alreadyRefunded + refundAmount,
      updatedAt: Date.now(),
      errorMessage: args.reason,
    })
    return { reversed: true }
  },
})

// Webhook event deduplication. Returns true if this is the first time we've
// seen the event; returns false if it's a duplicate (and the caller should
// skip its side-effects entirely). Also enforces a freshness window — events
// older than MAX_EVENT_AGE_MS are rejected as potential replays.
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export const recordWebhookEventIfNew = internalMutation({
  args: {
    provider: v.string(),
    eventId: v.string(),
    eventType: v.optional(v.string()),
    eventCreatedMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (
      typeof args.eventCreatedMs === 'number' &&
      Number.isFinite(args.eventCreatedMs) &&
      args.eventCreatedMs > 0 &&
      Date.now() - args.eventCreatedMs > MAX_EVENT_AGE_MS
    ) {
      return { accepted: false as const, reason: 'event_too_old' as const }
    }
    const existing = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId),
      )
      .first()
    if (existing) {
      return { accepted: false as const, reason: 'duplicate' as const }
    }
    await ctx.db.insert('processedWebhookEvents', {
      provider: args.provider,
      eventId: args.eventId,
      eventType: args.eventType,
      status: 'processed',
      attempt: 1,
      updatedAt: Date.now(),
      processedAt: Date.now(),
    })
    return { accepted: true as const }
  },
})

export const reserveProviderEventByServer = mutation({
  args: {
    serverSecret: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    payloadHash: v.string(),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId))
      .unique()
    if (existing) {
      if (existing.payloadHash && existing.payloadHash !== args.payloadHash) {
        throw new Error('billing event payload hash mismatch')
      }
      const processed = existing.status === 'processed' || !existing.status
      if (processed || existing.status === 'processing') {
        return { status: 'duplicate' as const, processed }
      }
      const attempt = (existing.attempt ?? 1) + 1
      await ctx.db.patch(existing._id, {
        attempt,
        errorMessage: undefined,
        eventType: args.eventType,
        payloadHash: args.payloadHash,
        status: 'processing',
        updatedAt: Date.now(),
      })
      return { status: 'acquired' as const, attempt }
    }
    const now = Date.now()
    await ctx.db.insert('processedWebhookEvents', {
      provider: args.provider,
      eventId: args.eventId,
      eventType: args.eventType,
      payloadHash: args.payloadHash,
      status: 'processing',
      attempt: 1,
      processedAt: now,
      updatedAt: now,
    })
    return { status: 'acquired' as const, attempt: 1 }
  },
})

export const markProviderEventProcessedByServer = mutation({
  args: { serverSecret: v.string(), eventId: v.string(), provider: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId))
      .unique()
    if (!existing) throw new Error('billing provider event not found')
    const now = Date.now()
    await ctx.db.patch(existing._id, {
      errorMessage: undefined,
      status: 'processed',
      processedAt: now,
      updatedAt: now,
    })
  },
})

export const markProviderEventFailedByServer = mutation({
  args: { serverSecret: v.string(), error: v.string(), eventId: v.string(), provider: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_provider_eventId', (q) =>
        q.eq('provider', args.provider).eq('eventId', args.eventId))
      .unique()
    if (!existing) throw new Error('billing provider event not found')
    await ctx.db.patch(existing._id, {
      errorMessage: args.error.slice(0, 2000),
      status: 'failed',
      updatedAt: Date.now(),
    })
  },
})

export const resolveUserIdByProviderReferenceByServer = query({
  args: {
    serverSecret: v.string(),
    provider: v.string(),
    providerCustomerId: v.optional(v.string()),
    providerSubscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.provider !== 'stripe') return null
    if (args.providerCustomerId) {
      const row = await ctx.db
        .query('subscriptions')
        .withIndex('by_stripeCustomerId', (q) => q.eq('stripeCustomerId', args.providerCustomerId))
        .unique()
      if (row) return row.userId
    }
    if (args.providerSubscriptionId) {
      const rows = await ctx.db.query('subscriptions').collect()
      return rows.find((row) => row.stripeSubscriptionId === args.providerSubscriptionId)?.userId ?? null
    }
    return null
  },
})

export const pruneOldWebhookEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - MAX_EVENT_AGE_MS
    const old = await ctx.db
      .query('processedWebhookEvents')
      .withIndex('by_processedAt', (q) => q.lt('processedAt', cutoff))
      .take(500)
    let deleted = 0
    for (const row of old) {
      await ctx.db.delete(row._id)
      deleted++
    }
    return { deleted }
  },
})

// Backfill email onto all existing tokenUsage rows that pre-date the email field.
// Run via Convex CLI: npx convex run subscriptions:backfillTokenUsageEmail [--prod]
export const backfillTokenUsageEmail = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allTokenUsage = await ctx.db.query('tokenUsage').collect()

    let migrated = 0

    for (const row of allTokenUsage) {
      if (row.email) continue // already has email

      const subscription = await ctx.db
        .query('subscriptions')
        .withIndex('by_userId', (q) => q.eq('userId', row.userId))
        .first()

      await ctx.db.patch(row._id, { email: subscription?.email ?? '' })
      migrated++
    }

    return { migrated, total: allTokenUsage.length }
  }
})
