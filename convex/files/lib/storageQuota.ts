import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import {
  derivePlanAmountCents,
  derivePlanKind,
  getStorageLimitBytes,
  type LegacyOverlayTier,
  type OverlayPlanKind,
} from '../../../src/shared/billing/billing-pricing'

type SubscriptionCtx = MutationCtx

export class StorageQuotaExceededError extends Error {
  constructor(message = 'storage_limit_exceeded') {
    super(message)
    this.name = 'StorageQuotaExceededError'
  }
}

function defaultBillingWindow(now: number) {
  return {
    currentPeriodStart: now,
    currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000,
  }
}

export async function getOrCreateSubscription(ctx: SubscriptionCtx, userId: string): Promise<Doc<'subscriptions'>> {
  const existing = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
  if (existing) return existing

  const now = Date.now()
  const createdId = await ctx.db.insert('subscriptions', {
    userId,
    tier: 'free',
    status: 'active',
    creditsUsed: 0,
    allowanceUsedCents: 0,
    topUpPurchasedCents: 0,
    topUpBalanceCents: 0,
    overlayStorageBytesUsed: 0,
    ...defaultBillingWindow(now),
  })
  const created = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
  if (!created) {
    throw new Error(`Failed to create subscription state for user ${userId}; insert=${String(createdId)}`)
  }
  return created
}

export function getSubscriptionTier(subscription: Doc<'subscriptions'> | null | undefined): LegacyOverlayTier {
  return (subscription?.tier ?? 'free') as LegacyOverlayTier
}

export function getSubscriptionPlanKind(subscription: Doc<'subscriptions'> | null | undefined): OverlayPlanKind {
  return derivePlanKind(subscription ?? {})
}

export function getStorageBytesUsed(subscription: Doc<'subscriptions'> | null | undefined): number {
  return Math.max(0, subscription?.overlayStorageBytesUsed ?? 0)
}

export function getStorageLimitForSubscription(subscription: Doc<'subscriptions'> | null | undefined): number {
  return getStorageLimitBytes({
    planKind: getSubscriptionPlanKind(subscription),
    planAmountCents: derivePlanAmountCents(subscription ?? {}),
  })
}

export async function applyStorageUsageDelta(ctx: SubscriptionCtx, userId: string, deltaBytes: number): Promise<Doc<'subscriptions'>> {
  const subscription = await getOrCreateSubscription(ctx, userId)
  const nextValue = Math.max(0, getStorageBytesUsed(subscription) + deltaBytes)
  await ctx.db.patch(subscription._id, { overlayStorageBytesUsed: nextValue })
  return {
    ...subscription,
    overlayStorageBytesUsed: nextValue,
  }
}

export async function ensureStorageAvailable(
  ctx: SubscriptionCtx,
  userId: string,
  requiredAdditionalBytes: number,
): Promise<Doc<'subscriptions'>> {
  const subscription = await getOrCreateSubscription(ctx, userId)
  if (requiredAdditionalBytes <= 0) return subscription
  const nextValue = getStorageBytesUsed(subscription) + requiredAdditionalBytes
  const limit = getStorageLimitForSubscription(subscription)
  if (nextValue > limit) {
    throw new StorageQuotaExceededError(
      `storage_limit_exceeded:${nextValue}:${limit}`
    )
  }
  return subscription
}
