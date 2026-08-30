import { v } from 'convex/values'
import {
  hasSameMemoryExtractionAuthor,
  selectMessagesAtOrBeforeTarget,
} from '@/shared/knowledge/memory-extraction-scope'
import { internalQuery } from '../_generated/server'

export const getRecentMessages = internalQuery({
  args: {
    conversationId: v.id('conversations'),
    targetMessageId: v.optional(v.id('conversationMessages')),
    userId: v.string(),
  },
  handler: async (ctx, { conversationId, targetMessageId, userId }) => {
    const recent = await ctx.db
      .query('conversationMessages')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('desc')
      .take(32)
    const target = targetMessageId ? await ctx.db.get(targetMessageId) : null
    const validTarget = target?.conversationId === conversationId ? target : null
    const messages = validTarget
      ? selectMessagesAtOrBeforeTarget(
          recent,
          validTarget,
          (message) => message._id === validTarget._id,
        )
      : recent

    return messages
      .filter((message) => validTarget
        ? hasSameMemoryExtractionAuthor(message, validTarget)
        : message.userId === userId && message.authorKind !== 'agent')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-8)
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
        return {
          id: m._id,
          authorKind: m.authorKind,
          role: m.role,
          turnId: m.turnId,
          text: text.slice(0, 800),
          createdAt: m.createdAt,
        }
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
