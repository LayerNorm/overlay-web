import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'

/**
 * Insert a mapping from a Slack source message to an Overlay conversation + message.
 * Called by the backfill worker after it creates a conversation and inserts messages.
 * Uses server-secret auth because the worker runs server-side.
 */
export const insertMapping = mutation({
  args: {
    importJobId: v.id('slackImportJobs'),
    workspaceId: v.string(),
    sourceChannelId: v.string(),
    sourceMessageTs: v.string(),
    conversationId: v.id('conversations'),
    messageId: v.optional(v.id('conversationMessages')),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) {
      throw new Error('Unauthorized')
    }
    await ctx.db.insert('slackImportMappings', {
      importJobId: args.importJobId,
      workspaceId: args.workspaceId,
      sourceChannelId: args.sourceChannelId,
      sourceMessageTs: args.sourceMessageTs,
      conversationId: args.conversationId,
      ...(args.messageId !== undefined ? { messageId: args.messageId } : {}),
    })
    return null
  },
})

/**
 * Find an existing mapping for a (workspaceId, sourceChannelId, sourceMessageTs) tuple.
 * Used by the backfill worker for dedup and resume support.
 */
export const findExisting = query({
  args: {
    workspaceId: v.string(),
    sourceChannelId: v.string(),
    sourceMessageTs: v.string(),
    serverSecret: v.string(),
  },
  returns: v.union(
    v.object({
      conversationId: v.string(),
      messageId: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const mapping = await ctx.db
      .query('slackImportMappings')
      .withIndex('by_workspaceId_sourceChannelId_sourceMessageTs', (q) =>
        q.eq('workspaceId', args.workspaceId)
          .eq('sourceChannelId', args.sourceChannelId)
          .eq('sourceMessageTs', args.sourceMessageTs),
      )
      .unique()
    if (!mapping) return null
    return {
      conversationId: mapping.conversationId as string,
      ...(mapping.messageId !== undefined ? { messageId: mapping.messageId as string } : {}),
    }
  },
})

/**
 * Find an existing conversation mapping for a Slack channel (any message).
 * Used to resume an interrupted import for a specific channel.
 */
export const findChannelConversation = query({
  args: {
    importJobId: v.id('slackImportJobs'),
    sourceChannelId: v.string(),
    serverSecret: v.string(),
  },
  returns: v.union(
    v.object({
      conversationId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const mapping = await ctx.db
      .query('slackImportMappings')
      .withIndex('by_importJobId_sourceChannelId', (q) =>
        q.eq('importJobId', args.importJobId)
          .eq('sourceChannelId', args.sourceChannelId),
      )
      .first()
    if (!mapping) return null
    return { conversationId: mapping.conversationId as string }
  },
})

/**
 * Count messages already imported for a specific channel in a job.
 * Used by the backfill worker to report progress.
 */
export const countChannelMessages = query({
  args: {
    importJobId: v.id('slackImportJobs'),
    sourceChannelId: v.string(),
    serverSecret: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return 0
    const mappings = await ctx.db
      .query('slackImportMappings')
      .withIndex('by_importJobId_sourceChannelId', (q) =>
        q.eq('importJobId', args.importJobId)
          .eq('sourceChannelId', args.sourceChannelId),
      )
      .collect()
    return mappings.length
  },
})
