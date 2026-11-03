import type { MutationCtx } from '../../_generated/server'
import { assertOwnedFileR2Key } from '../../../src/shared/storage/storage-keys'
import {
  getOrCreateSubscription,
  getStorageBytesUsed,
  getStorageLimitForUser,
} from './storageQuota'

async function getPendingUploadIntentBytes(ctx: MutationCtx, userId: string): Promise<number> {
  const pending = await ctx.db
    .query('r2UploadIntents')
    .withIndex('by_userId_status_expiresAt', q => q.eq('userId', userId).eq('status', 'pending'))
    .collect()
  return pending.reduce((sum, intent) => sum + Math.max(0, intent.declaredSizeBytes), 0)
}

export async function reserveUploadIntent(ctx: MutationCtx, args: {
  userId: string
  r2Key: string
  declaredSizeBytes: number
  mimeType?: string
  checksumSha256?: string
  expiresAt: number
  now?: number
}) {
  assertOwnedFileR2Key(args.userId, args.r2Key)
  const declaredSizeBytes = Math.round(args.declaredSizeBytes)
  if (!Number.isSafeInteger(declaredSizeBytes) || declaredSizeBytes <= 0) {
    throw new Error('invalid_upload_intent_size')
  }
  if (!Number.isFinite(args.expiresAt)) throw new Error('invalid_upload_intent_expiry')
  if (args.checksumSha256 !== undefined && !/^[a-f0-9]{64}$/.test(args.checksumSha256)) {
    throw new Error('invalid_upload_checksum')
  }

  const existing = await ctx.db
    .query('r2UploadIntents')
    .withIndex('by_r2Key', q => q.eq('r2Key', args.r2Key))
    .first()
  if (existing) throw new Error('upload_intent_already_exists')

  const [subscription, pendingBytes] = await Promise.all([
    getOrCreateSubscription(ctx, args.userId),
    getPendingUploadIntentBytes(ctx, args.userId),
  ])
  const nextReservedBytes = getStorageBytesUsed(subscription) + pendingBytes + declaredSizeBytes
  const storageLimitBytes = await getStorageLimitForUser(ctx, args.userId)
  if (nextReservedBytes > storageLimitBytes) {
    throw new Error(`storage_limit_exceeded:${nextReservedBytes}:${storageLimitBytes}`)
  }

  return await ctx.db.insert('r2UploadIntents', {
    userId: args.userId,
    r2Key: args.r2Key,
    declaredSizeBytes,
    mimeType: args.mimeType,
    checksumSha256: args.checksumSha256,
    status: 'pending',
    createdAt: args.now ?? Date.now(),
    expiresAt: args.expiresAt,
  })
}
