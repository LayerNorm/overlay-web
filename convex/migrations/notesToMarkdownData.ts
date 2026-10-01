import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'

/** One page of note rows (live and deleted) for the Markdown backfill. */
export const notePage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('files')
      .withIndex('by_outputExpiry', (q) => q.eq('kind', 'note'))
      .paginate(args.paginationOpts)
    return {
      notes: page.page.map((row) => ({
        _id: row._id,
        content: row.textContent ?? row.content ?? '',
        updatedAt: row.updatedAt,
      })),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

/**
 * Writes the converted body only if the note is unchanged since it was read.
 * `updatedAt` is kept: the conversion is not an edit, and an open editor's
 * next save converts its own HTML the same way.
 */
export const writeConvertedNote = internalMutation({
  args: {
    fileId: v.id('files'),
    expectedUpdatedAt: v.number(),
    expectedContent: v.string(),
    content: v.string(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fileId)
    if (!row || row.kind !== 'note' || row.updatedAt !== args.expectedUpdatedAt) return 'changed' as const
    if ((row.textContent ?? row.content ?? '') !== args.expectedContent) return 'changed' as const
    await ctx.db.patch(args.fileId, { content: args.content, textContent: undefined, contentHash: args.contentHash })
    return 'converted' as const
  },
})
