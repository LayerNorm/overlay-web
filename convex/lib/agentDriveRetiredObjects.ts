import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/** Register the old version in the same transaction that replaces its Files pointer. */
export async function retireDriveContent(ctx: MutationCtx, file: Doc<'files'>, now: number) {
  const source = file.r2Key ? { kind: 'object' as const, key: file.r2Key }
    : file.storageId ? { kind: 'convex' as const, storageId: file.storageId } : null
  if (!source) return
  await ctx.db.insert('agentDriveRetiredObjects', { ownerUserId: file.userId,
    sizeBytes: file.sizeBytes ?? 0, source, retiredAt: now, nextAttemptAt: now + 24 * 60 * 60_000,
    state: { kind: 'waiting' } })
}
