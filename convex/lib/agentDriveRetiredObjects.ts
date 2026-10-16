import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/** Register the old version in the same transaction that replaces its Files pointer. */
export async function retireDriveContent(ctx: MutationCtx, file: Doc<'files'>, now: number) {
  const source = file.r2Key ? { kind: 'object' as const, key: file.r2Key }
    : file.storageId ? { kind: 'convex' as const, storageId: file.storageId } : null
  if (!source) return
  await ctx.db.insert('agentDriveRetiredObjects', { ownerUserId: file.userId,
    purpose: 'version', sizeBytes: file.sizeBytes ?? 0, source, retiredAt: now, nextAttemptAt: now + 24 * 60 * 60_000,
    state: { kind: 'waiting' } })
}

/** Register before any signed upload or server seal can create bytes, including a lost response. */
export async function queueDriveUploadObjects(ctx: MutationCtx, input: {
  ownerUserId: string; stagingKey: string; finalKey: string; hardDeadlineAt: number; now: number
}) {
  // Wait until the entire execution is no longer authorized, plus a full day;
  // an intent's shorter expiry alone does not bound a run or its retries.
  for (const [purpose, key] of [['staging', input.stagingKey], ['uncommitted', input.finalKey]] as const) {
    await ctx.db.insert('agentDriveRetiredObjects', { ownerUserId: input.ownerUserId, purpose,
      sizeBytes: 0, source: { kind: 'object', key }, retiredAt: input.now,
      nextAttemptAt: input.hardDeadlineAt + 24 * 60 * 60_000, state: { kind: 'waiting' } })
  }
}
