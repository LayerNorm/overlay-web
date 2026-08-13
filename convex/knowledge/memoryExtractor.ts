import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'

export const getRecentMessages = internalQuery({
  args: { conversationId: v.id('conversations'), userId: v.string() },
  handler: async (ctx, { conversationId, userId }) => {
    const messages = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('desc')
      .take(8)

    return messages
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => {
        const textParts =
          m.parts
            ?.filter(
              (p): p is { type: string; text?: string } =>
                typeof p === 'object' &&
                p !== null &&
                'type' in p &&
                p.type === 'text' &&
                'text' in p &&
                typeof (p as { text?: string }).text === 'string',
            )
            .map((p) => p.text || '') ?? []
        const text = textParts.join(' ').trim() || m.content
        return { role: m.role, turnId: m.turnId, text: text.slice(0, 800), createdAt: m.createdAt }
      })
  },
})

export const findExactDuplicate = internalQuery({
  args: {
    normalizedContent: v.string(),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, workspaceId, normalizedContent }) => {
    const memories = workspaceId
      ? await ctx.db
          .query('memories')
          .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
          .take(100)
      : await ctx.db
          .query('memories')
          .withIndex('by_userId', (q) => q.eq('userId', userId))
          .take(100)

    for (const m of memories) {
      if (m.deletedAt || m.workspaceId !== workspaceId) continue
      const existingNorm = m.content.toLowerCase().replace(/\s+/g, ' ').trim()
      if (existingNorm === normalizedContent) return m._id
    }
    return null
  },
})
