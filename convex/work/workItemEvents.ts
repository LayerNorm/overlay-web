import { v } from 'convex/values'
import { query, mutation } from '../_generated/server'
import { workAuth, eventDoc } from './validators'
import { authorize, fail, readable, recordEvent } from './rules'

export const list = query({
  args: { ...workAuth, id: v.id('workItems') }, returns: v.array(eventDoc),
  handler: async (ctx, args) => {
    await authorize(ctx, args); await readable(ctx, args, args.id)
    return ctx.db.query('workItemEvents').withIndex('by_workItemId_createdAt', (q) => q.eq('workItemId', args.id)).order('desc').take(200)
  },
})
export const comment = mutation({
  args: { ...workAuth, id: v.id('workItems'), text: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const row = await readable(ctx, args, args.id)
    if (row.archivedAt !== undefined) fail('INVALID', 'Restore the task before commenting')
    if (!args.text.trim() || args.text.length > 5000) fail('INVALID', 'Comments must contain 1–5000 characters')
    await recordEvent(ctx, args, row._id, 'comment', { text: args.text.trim() })
    return null
  },
})
