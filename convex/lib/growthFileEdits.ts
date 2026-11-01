import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * Notes that a file's text changed today, for growth analytics. Each (file,
 * UTC day) keeps every person who edited it, so later edits never erase
 * earlier ones. Agent writes pass no editor: the edit counts, no one is credited.
 */
export async function recordFileEdit(ctx: MutationCtx, fileId: Id<'files'>, editorUserId: string | undefined, now: number) {
  const day = new Date(now).toISOString().slice(0, 10)
  const existing = await ctx.db.query('growthFileEdits')
    .withIndex('by_fileId_day', (q) => q.eq('fileId', fileId).eq('day', day)).unique()
  if (!existing) {
    await ctx.db.insert('growthFileEdits', { fileId, day, editorUserIds: editorUserId ? [editorUserId] : [] })
    return
  }
  if (editorUserId && !existing.editorUserIds.includes(editorUserId)) {
    await ctx.db.patch(existing._id, { editorUserIds: [...existing.editorUserIds, editorUserId] })
  }
}
