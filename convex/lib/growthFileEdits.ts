import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * Notes that a file's text changed today, for growth analytics. The (file, UTC
 * day) row counts the edit; the editor is credited as active that day directly,
 * so later edits never erase earlier ones. Agent writes pass no editor: the
 * edit counts, no one is credited.
 */
export async function recordFileEdit(ctx: MutationCtx, fileId: Id<'files'>, editorUserId: string | undefined, now: number) {
  const day = new Date(now).toISOString().slice(0, 10)
  const edit = await ctx.db.query('growthFileEdits')
    .withIndex('by_fileId_day', (q) => q.eq('fileId', fileId).eq('day', day)).unique()
  if (!edit) await ctx.db.insert('growthFileEdits', { fileId, day })
  if (!editorUserId) return
  const userDay = await ctx.db.query('growthUserDays')
    .withIndex('by_userId_day', (q) => q.eq('userId', editorUserId).eq('day', day)).unique()
  if (!userDay) await ctx.db.insert('growthUserDays', { userId: editorUserId, day })
}
