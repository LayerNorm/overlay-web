import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { derivePlanAmountCents, derivePlanKind } from '../../src/shared/billing/billing-pricing'
import { ensurePersonalBillingAccount } from './accountModel'

const MICROS_PER_CENT = 10_000
const ATTACH_BATCH_SIZE = 100

const attachmentCountsValidator = v.object({
  budgetReservations: v.number(),
  budgetTopUps: v.number(),
  daytonaUsageLedger: v.number(),
  subscriptions: v.number(),
  tokenUsage: v.number(),
  toolInvocations: v.number(),
  usageOperations: v.number(),
})

const balanceSnapshotValidator = v.object({
  allowanceUsedMicros: v.number(),
  billingAccountId: v.string(),
  includedMicros: v.number(),
  institutionalGrantMicros: v.number(),
  mode: v.union(v.literal('unlimited'), v.literal('budgeted')),
  reservedMicros: v.number(),
  topUpBalanceMicros: v.number(),
  topUpPurchasedMicros: v.number(),
  usedMicros: v.number(),
})

const parityValidator = v.object({
  billingAccountId: v.string(),
  canonical: balanceSnapshotValidator,
  differences: v.array(v.string()),
  legacy: balanceSnapshotValidator,
  matches: v.boolean(),
  userId: v.string(),
})

const verificationRowValidator = v.object({
  billingAccountId: v.optional(v.string()),
  planAmountCents: v.number(),
  providerCustomerId: v.optional(v.string()),
  providerPriceId: v.optional(v.string()),
  providerQuantity: v.optional(v.number()),
  providerSubscriptionId: v.optional(v.string()),
  status: v.union(
    v.literal('active'),
    v.literal('canceled'),
    v.literal('past_due'),
    v.literal('trialing'),
  ),
  userId: v.string(),
})

export const listPersonalBackfillCandidatesByServer = query({
  args: {
    afterUserId: v.optional(v.string()),
    limit: v.optional(v.number()),
    serverSecret: v.string(),
  },
  returns: v.object({
    done: v.boolean(),
    nextAfterUserId: v.optional(v.string()),
    userIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = boundedLimit(args.limit, 50, 200)
    const rows = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => args.afterUserId
        ? q.gt('userId', args.afterUserId)
        : q)
      .take(limit + 1)
    const page = rows.slice(0, limit)
    return {
      done: rows.length <= limit,
      ...(page.length === 0 ? {} : { nextAfterUserId: page[page.length - 1]!.userId }),
      userIds: page.map((row) => row.userId),
    }
  },
})

export const backfillPersonalByUserByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    attached: attachmentCountsValidator,
    billingAccountId: v.string(),
    complete: v.boolean(),
    userId: v.string(),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const userId = args.userId.trim()
    if (!userId) throw new Error('billing_account_user_required')
    const account = await ensurePersonalBillingAccount(ctx, userId)
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique()
    const attached = {
      budgetReservations: 0,
      budgetTopUps: 0,
      daytonaUsageLedger: 0,
      subscriptions: 0,
      tokenUsage: 0,
      toolInvocations: 0,
      usageOperations: 0,
    }
    if (subscription && subscription.billingAccountId !== account.billingAccountId) {
      if (subscription.billingAccountId) throw new Error('legacy_subscription_account_conflict')
      await ctx.db.patch(subscription._id, { billingAccountId: account.billingAccountId })
      attached.subscriptions = 1
    }

    const pages = await attachLegacyRows(ctx, userId, account.billingAccountId)
    Object.assign(attached, pages.attached, { subscriptions: attached.subscriptions })
    if (subscription) await syncCanonicalSubscription(ctx, account.billingAccountId, subscription)
    await syncCanonicalBalance(ctx, account.billingAccountId, subscription, pages.reservations)
    return {
      attached,
      billingAccountId: account.billingAccountId,
      complete: pages.complete,
      userId,
    }
  },
})

export const getPersonalBalanceParityByServer = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.union(parityValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const account = await ctx.db
      .query('billingAccounts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId.trim()))
      .unique()
    if (!account) return null
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId.trim()))
      .unique()
    const reservations = await activeReservationSummary(ctx, account.billingAccountId)
    if (reservations.truncated) throw new Error('billing_parity_reservations_truncated')
    const canonical = await ctx.db
      .query('billingAccountBalances')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId))
      .unique()
    if (!canonical) return null
    const legacy = legacyBalanceSnapshot(account.billingAccountId, subscription, reservations.reservedCents)
    const canonicalSnapshot = {
      allowanceUsedMicros: canonical.allowanceUsedMicros,
      billingAccountId: canonical.billingAccountId,
      includedMicros: canonical.includedMicros,
      institutionalGrantMicros: canonical.institutionalGrantMicros,
      mode: canonical.mode,
      reservedMicros: canonical.reservedMicros,
      topUpBalanceMicros: canonical.topUpBalanceMicros,
      topUpPurchasedMicros: canonical.topUpPurchasedMicros,
      usedMicros: canonical.usedMicros,
    }
    const differences = balanceDifferences(legacy, canonicalSnapshot)
    return {
      billingAccountId: account.billingAccountId,
      canonical: canonicalSnapshot,
      differences,
      legacy,
      matches: differences.length === 0,
      userId: args.userId.trim(),
    }
  },
})

export const listSubscriptionVerificationRowsByServer = query({
  args: {
    limit: v.optional(v.number()),
    serverSecret: v.string(),
  },
  returns: v.array(verificationRowValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('subscriptions').take(boundedLimit(args.limit, 100, 500))
    return rows.map((row) => ({
      ...(row.billingAccountId === undefined ? {} : { billingAccountId: row.billingAccountId }),
      planAmountCents: derivePlanAmountCents(row),
      ...(row.stripeCustomerId ? { providerCustomerId: row.stripeCustomerId } : {}),
      ...(row.stripePriceId === undefined ? {} : { providerPriceId: row.stripePriceId }),
      ...(row.stripeQuantity === undefined ? {} : { providerQuantity: row.stripeQuantity }),
      ...(row.stripeSubscriptionId ? { providerSubscriptionId: row.stripeSubscriptionId } : {}),
      status: row.status,
      userId: row.userId,
    }))
  },
})

export async function syncPersonalBillingShadows(
  ctx: MutationCtx,
  userId: string,
  billingAccountId: string,
): Promise<void> {
  const subscription = await ctx.db.query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()
  if (subscription) {
    if (subscription.billingAccountId && subscription.billingAccountId !== billingAccountId) {
      throw new Error('legacy_subscription_account_conflict')
    }
    if (!subscription.billingAccountId) {
      await ctx.db.patch(subscription._id, { billingAccountId })
    }
    await syncCanonicalSubscription(ctx, billingAccountId, subscription)
  }
  await syncCanonicalBalance(
    ctx,
    billingAccountId,
    subscription,
    await activeReservationSummary(ctx, billingAccountId),
  )
}

async function attachLegacyRows(
  ctx: MutationCtx,
  userId: string,
  billingAccountId: string,
) {
  const budgetTopUps = await ctx.db.query('budgetTopUps')
    .withIndex('by_userId_billingAccountId', (q) => q.eq('userId', userId).eq('billingAccountId', undefined))
    .take(ATTACH_BATCH_SIZE + 1)
  const tokenUsage = await ctx.db.query('tokenUsage')
    .withIndex('by_userId_billingAccountId', (q) => q.eq('userId', userId).eq('billingAccountId', undefined))
    .take(ATTACH_BATCH_SIZE + 1)
  const budgetReservations = await ctx.db.query('budgetReservations')
    .withIndex('by_userId_billingAccountId', (q) => q.eq('userId', userId).eq('billingAccountId', undefined))
    .take(ATTACH_BATCH_SIZE + 1)
  const usageOperations = await ctx.db.query('usageOperations')
    .withIndex('by_userId_billingAccountId', (q) => q.eq('userId', userId).eq('billingAccountId', undefined))
    .take(ATTACH_BATCH_SIZE + 1)
  const daytonaUsageLedger = await ctx.db.query('daytonaUsageLedger')
    .withIndex('by_userId_billingAccountId', (q) => q.eq('userId', userId).eq('billingAccountId', undefined))
    .take(ATTACH_BATCH_SIZE + 1)
  const toolInvocations = await ctx.db.query('toolInvocations')
    .withIndex('by_userId_billingAccountId', (q) => q.eq('userId', userId).eq('billingAccountId', undefined))
    .take(ATTACH_BATCH_SIZE + 1)
  const pages = {
    budgetReservations,
    budgetTopUps,
    daytonaUsageLedger,
    tokenUsage,
    toolInvocations,
    usageOperations,
  }
  for (const rows of Object.values(pages)) {
    for (const row of rows.slice(0, ATTACH_BATCH_SIZE)) {
      await ctx.db.patch(row._id, { billingAccountId })
    }
  }
  const reservations = await activeReservationSummary(ctx, billingAccountId)
  return {
    attached: {
      budgetReservations: Math.min(budgetReservations.length, ATTACH_BATCH_SIZE),
      budgetTopUps: Math.min(budgetTopUps.length, ATTACH_BATCH_SIZE),
      daytonaUsageLedger: Math.min(daytonaUsageLedger.length, ATTACH_BATCH_SIZE),
      tokenUsage: Math.min(tokenUsage.length, ATTACH_BATCH_SIZE),
      toolInvocations: Math.min(toolInvocations.length, ATTACH_BATCH_SIZE),
      usageOperations: Math.min(usageOperations.length, ATTACH_BATCH_SIZE),
    },
    complete: Object.values(pages).every((rows) => rows.length <= ATTACH_BATCH_SIZE) && !reservations.truncated,
    reservations,
  }
}

async function syncCanonicalSubscription(
  ctx: MutationCtx,
  billingAccountId: string,
  subscription: Doc<'subscriptions'>,
): Promise<void> {
  const existing = await ctx.db.query('billingAccountSubscriptions')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
    .unique()
  const now = Date.now()
  const value = {
    autoTopUpAmountCents: subscription.autoTopUpAmountCents ?? 0,
    autoTopUpEnabled: subscription.autoTopUpEnabled ?? false,
    billingAccountId,
    ...(subscription.currentPeriodEnd === undefined ? {} : { currentPeriodEnd: subscription.currentPeriodEnd }),
    ...(subscription.currentPeriodStart === undefined ? {} : { currentPeriodStart: subscription.currentPeriodStart }),
    markupBasisPoints: subscription.markupBasisPoints ?? 2_500,
    ...(subscription.offSessionConsentAt === undefined ? {} : { offSessionConsentAt: subscription.offSessionConsentAt }),
    planAmountCents: derivePlanAmountCents(subscription),
    planKind: derivePlanKind(subscription),
    planVersion: 'variable_v2' as const,
    provider: 'stripe',
    ...(subscription.stripeCustomerId ? { providerCustomerId: subscription.stripeCustomerId } : {}),
    ...(subscription.stripePriceId === undefined ? {} : { providerPriceId: subscription.stripePriceId }),
    ...(subscription.stripeQuantity === undefined ? {} : { providerQuantity: subscription.stripeQuantity }),
    ...(subscription.stripeSubscriptionId ? { providerSubscriptionId: subscription.stripeSubscriptionId } : {}),
    status: subscription.status,
    ...(subscription.cancelAtPeriodEnd === undefined
      ? {}
      : { cancelAtPeriodEnd: subscription.cancelAtPeriodEnd }),
    updatedAt: now,
  }
  if (existing) {
    await ctx.db.patch(existing._id, value)
  } else {
    await ctx.db.insert('billingAccountSubscriptions', { ...value, createdAt: now })
  }
}

async function syncCanonicalBalance(
  ctx: MutationCtx,
  billingAccountId: string,
  subscription: Doc<'subscriptions'> | null,
  reservations: { reservedCents: number; truncated: boolean },
): Promise<void> {
  if (reservations.truncated) throw new Error('billing_balance_reservations_truncated')
  const existing = await ctx.db.query('billingAccountBalances')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
    .unique()
  if (!existing) throw new Error('billing_account_balance_missing')
  const legacy = legacyBalanceSnapshot(billingAccountId, subscription, reservations.reservedCents)
  await ctx.db.patch(existing._id, {
    allowanceUsedMicros: legacy.allowanceUsedMicros,
    includedMicros: legacy.includedMicros,
    institutionalGrantMicros: legacy.institutionalGrantMicros,
    mode: legacy.mode,
    reservedMicros: legacy.reservedMicros,
    topUpBalanceMicros: legacy.topUpBalanceMicros,
    topUpPurchasedMicros: legacy.topUpPurchasedMicros,
    updatedAt: Date.now(),
    usedMicros: legacy.usedMicros,
    version: existing.version + 1,
  })
}

async function activeReservationSummary(ctx: QueryCtx | MutationCtx, billingAccountId: string) {
  const [reserved, reconcileRequired] = await Promise.all([
    ctx.db.query('budgetReservations')
      .withIndex('by_billingAccountId_status_createdAt', (q) => q
        .eq('billingAccountId', billingAccountId)
        .eq('status', 'reserved'))
      .take(1_001),
    ctx.db.query('budgetReservations')
      .withIndex('by_billingAccountId_status_createdAt', (q) => q
        .eq('billingAccountId', billingAccountId)
        .eq('status', 'reconcile_required'))
      .take(1_001),
  ])
  const rows = [...reserved, ...reconcileRequired]
  return {
    reservedCents: rows.reduce((sum, row) => sum + row.reservedCents, 0),
    truncated: reserved.length > 1_000 || reconcileRequired.length > 1_000,
  }
}

function legacyBalanceSnapshot(
  billingAccountId: string,
  subscription: Doc<'subscriptions'> | null,
  reservedCents: number,
) {
  const usedCents = Math.max(0, subscription?.creditsUsed ?? 0)
  const includedCents = derivePlanKind(subscription ?? {}) === 'paid'
    ? derivePlanAmountCents(subscription ?? {})
    : 0
  const institutionalGrantCents = Math.max(0, subscription?.institutionalGrantCents ?? 0)
  const allowanceUsedCents = Math.max(
    0,
    subscription?.allowanceUsedCents ?? Math.min(usedCents, includedCents + institutionalGrantCents),
  )
  const topUpPurchasedCents = Math.max(0, subscription?.topUpPurchasedCents ?? 0)
  const topUpBalanceCents = Math.max(
    0,
    subscription?.topUpBalanceCents ?? topUpPurchasedCents - Math.max(0, usedCents - allowanceUsedCents),
  )
  return {
    allowanceUsedMicros: Math.round(allowanceUsedCents * MICROS_PER_CENT),
    billingAccountId,
    includedMicros: Math.round(includedCents * MICROS_PER_CENT),
    institutionalGrantMicros: Math.round(institutionalGrantCents * MICROS_PER_CENT),
    mode: 'budgeted' as const,
    reservedMicros: Math.round(reservedCents * MICROS_PER_CENT),
    topUpBalanceMicros: Math.round(topUpBalanceCents * MICROS_PER_CENT),
    topUpPurchasedMicros: Math.round(topUpPurchasedCents * MICROS_PER_CENT),
    usedMicros: Math.round(usedCents * MICROS_PER_CENT),
  }
}

function balanceDifferences(
  legacy: ReturnType<typeof legacyBalanceSnapshot>,
  canonical: Omit<ReturnType<typeof legacyBalanceSnapshot>, 'mode'> & {
    mode: 'budgeted' | 'unlimited'
  },
): string[] {
  const fields = [
    'billingAccountId',
    'mode',
    'includedMicros',
    'institutionalGrantMicros',
    'allowanceUsedMicros',
    'topUpPurchasedMicros',
    'topUpBalanceMicros',
    'usedMicros',
    'reservedMicros',
  ] as const
  return fields.filter((field) => legacy[field] !== canonical[field])
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  return Math.min(Math.max(Math.floor(value ?? fallback), 1), maximum)
}
