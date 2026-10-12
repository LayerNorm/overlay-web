import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { paidWorkspaceAccountFor } from '../../billing/workspacePayer'
import { FREE_PLAN_STORAGE_BYTES, getStorageLimitBytes } from '../../../src/shared/billing/billing-pricing'

type SubscriptionCtx = MutationCtx

export class StorageQuotaExceededError extends Error {
  constructor(message = 'storage_limit_exceeded') {
    super(message)
    this.name = 'StorageQuotaExceededError'
  }
}

export async function getOrCreateSubscription(ctx: SubscriptionCtx, userId: string): Promise<Doc<'subscriptions'>> {
  const existing = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
  if (existing) return existing

  const createdId = await ctx.db.insert('subscriptions', { userId, overlayStorageBytesUsed: 0 })
    // Read-your-write: must run after the insert above, not concurrently.
    // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const created = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
  if (!created) {
    throw new Error(`Failed to create subscription state for user ${userId}; insert=${String(createdId)}`)
  }
  return created
}

export function getStorageBytesUsed(subscription: Doc<'subscriptions'> | null | undefined): number {
  return Math.max(0, subscription?.overlayStorageBytesUsed ?? 0)
}

/**
 * A person's storage limit: the free amount, raised to the workspace's when they are working in a workspace with a
 * paid plan (an account has no plan of its own). Bytes are still counted per person.
 */
export async function getStorageLimitForUser(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<number> {
  const workspace = await paidWorkspaceAccountFor(ctx, userId)
  if (!workspace) return FREE_PLAN_STORAGE_BYTES
  return Math.max(FREE_PLAN_STORAGE_BYTES, getStorageLimitBytes({ planKind: 'paid', planAmountCents: workspace.planAmountCents }))
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
  const limit = await getStorageLimitForUser(ctx, userId)
  if (nextValue > limit) {
    throw new StorageQuotaExceededError(
      `storage_limit_exceeded:${nextValue}:${limit}`
    )
  }
  return subscription
}
