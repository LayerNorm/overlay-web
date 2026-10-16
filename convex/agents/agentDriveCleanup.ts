import { v } from 'convex/values'
import { mutation, type MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'
import { applyStorageUsageDelta } from '../files/lib/storageQuota'

type Retired = Doc<'agentDriveRetiredObjects'>
const RETRY_MS = 10 * 60_000

async function referenced(ctx: MutationCtx, row: Retired) {
  const source = row.source
  // Tombstones and archived rows count too: restore must retain their bytes.
  return source.kind === 'object'
    ? Boolean(await ctx.db.query('files').withIndex('by_r2Key', q => q.eq('r2Key', source.key)).first())
    : Boolean(await ctx.db.query('files').withIndex('by_storageId', q => q.eq('storageId', source.storageId)).first())
}

/** The BFF owns object-store credentials. Only unreferenced retired versions leave this transaction. */
export const claimByServer = mutation({
  args: { serverSecret: v.string(), claim: v.string() },
  returns: v.object({ objects: v.array(v.object({ id: v.id('agentDriveRetiredObjects'), key: v.string() })), convexDeleted: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(args.claim)) throw Error('Invalid cleanup claim')
    const now = Date.now()
    // Receipt/budget retention exceeds the complete execution, not just a
    // short-lived credential. Object cleanup tickets survive these rows.
    for (const row of await ctx.db.query('agentDriveUploads').withIndex('by_retireAt', q => q.lte('retireAt', now)).take(32)) await ctx.db.delete(row._id)
    for (const row of await ctx.db.query('agentDriveWriteBudgets').withIndex('by_expiresAt', q => q.lte('expiresAt', now)).take(32)) await ctx.db.delete(row._id)
    const due = await ctx.db.query('agentDriveRetiredObjects').withIndex('by_nextAttemptAt', q => q.lte('nextAttemptAt', now)).take(32)
    const objects: { id: Retired['_id']; key: string }[] = []
    let convexDeleted = 0
    for (const row of due) {
      if (await referenced(ctx, row)) {
        // A lost commit response may have published this final object. Its live
        // Files pointer owns it; only a later replacement can retire that version.
        if (row.purpose === 'uncommitted') await ctx.db.delete(row._id)
        else await ctx.db.patch(row._id, { nextAttemptAt: now + RETRY_MS })
        continue
      }
      if (row.source.kind === 'convex') {
        // Convex storage deletion and quota release share this transaction.
        await ctx.storage.delete(row.source.storageId)
        await applyStorageUsageDelta(ctx, row.ownerUserId, -row.sizeBytes)
        await ctx.db.delete(row._id)
        convexDeleted++
      } else {
        await ctx.db.patch(row._id, { state: { kind: 'deleting', claim: args.claim }, nextAttemptAt: now + RETRY_MS })
        objects.push({ id: row._id, key: row.source.key })
      }
    }
    return { objects, convexDeleted }
  },
})

/** An ambiguous storage response never releases bytes. DELETE and this receipt are both retryable. */
export const acknowledgeByServer = mutation({
  args: { serverSecret: v.string(), id: v.id('agentDriveRetiredObjects'), claim: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.get(args.id)
    if (!row) return true
    if (row.source.kind !== 'object' || row.state.kind !== 'deleting' || row.state.claim !== args.claim) return false
    if (await referenced(ctx, row)) return false
    await applyStorageUsageDelta(ctx, row.ownerUserId, -row.sizeBytes)
    await ctx.db.delete(row._id)
    return true
  },
})
