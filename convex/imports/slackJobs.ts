import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'

async function authorize(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) return
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

const coverageFields = {
  coverage: v.optional(v.object({
    publicChannels: v.number(),
    privateChannels: v.number(),
    dms: v.number(),
    mpims: v.number(),
    messagesImported: v.number(),
    filesDownloaded: v.number(),
    threadsImported: v.number(),
  })),
}

/**
 * Create a Slack import job. Called by the BFF after the user selects
 * which channels to import. The server worker picks up the job and
 * processes it asynchronously.
 */
export const createJob = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.string(),
    connectedAccountId: v.string(),
    selectedChannelIds: v.array(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.object({
    jobId: v.string(),
  }),
  handler: async (ctx, args) => {
    await authorize({
      userId: args.userId,
      accessToken: args.accessToken,
      serverSecret: args.serverSecret,
    })
    const now = Date.now()
    const jobId = await ctx.db.insert('slackImportJobs', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      connectedAccountId: args.connectedAccountId,
      status: 'queued',
      selectedChannelIds: args.selectedChannelIds,
      createdAt: now,
      updatedAt: now,
    })
    return { jobId: jobId as string }
  },
})

/**
 * Get a single Slack import job by ID.
 */
export const getJob = query({
  args: {
    jobId: v.id('slackImportJobs'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      _id: v.string(),
      workspaceId: v.string(),
      connectedAccountId: v.string(),
      status: v.string(),
      selectedChannelIds: v.array(v.string()),
      totalChannels: v.optional(v.number()),
      processedChannels: v.optional(v.number()),
      totalMessages: v.optional(v.number()),
      ...coverageFields,
      error: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    try {
      await authorize({
        userId: args.userId,
        accessToken: args.accessToken,
        serverSecret: args.serverSecret,
      })
    } catch {
      return null
    }
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.userId) return null
    return {
      _id: job._id as string,
      workspaceId: job.workspaceId,
      connectedAccountId: job.connectedAccountId,
      status: job.status,
      selectedChannelIds: job.selectedChannelIds,
      ...(job.totalChannels !== undefined ? { totalChannels: job.totalChannels } : {}),
      ...(job.processedChannels !== undefined ? { processedChannels: job.processedChannels } : {}),
      ...(job.totalMessages !== undefined ? { totalMessages: job.totalMessages } : {}),
      ...(job.coverage ? { coverage: job.coverage } : {}),
      ...(job.error ? { error: job.error } : {}),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    }
  },
})

/**
 * Update job status (server-secret only, called by the backfill worker).
 */
export const updateJobStatus = mutation({
  args: {
    jobId: v.id('slackImportJobs'),
    status: v.union(
      v.literal('queued'),
      v.literal('listing_channels'),
      v.literal('importing'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    totalChannels: v.optional(v.number()),
    processedChannels: v.optional(v.number()),
    totalMessages: v.optional(v.number()),
    coverage: v.optional(v.object({
      publicChannels: v.number(),
      privateChannels: v.number(),
      dms: v.number(),
      mpims: v.number(),
      messagesImported: v.number(),
      filesDownloaded: v.number(),
      threadsImported: v.number(),
    })),
    error: v.optional(v.string()),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) {
      throw new Error('Unauthorized')
    }
    const job = await ctx.db.get(args.jobId)
    if (!job) throw new Error('Job not found')
    const now = Date.now()
    await ctx.db.patch(args.jobId, {
      status: args.status,
      updatedAt: now,
      ...(args.totalChannels !== undefined ? { totalChannels: args.totalChannels } : {}),
      ...(args.processedChannels !== undefined ? { processedChannels: args.processedChannels } : {}),
      ...(args.totalMessages !== undefined ? { totalMessages: args.totalMessages } : {}),
      ...(args.coverage !== undefined ? { coverage: args.coverage } : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
      ...((args.status === 'completed' || args.status === 'failed' || args.status === 'cancelled')
        ? { completedAt: now }
        : {}),
    })
    return null
  },
})

/**
 * Cancel a running Slack import job (client-initiated).
 */
export const cancelJob = mutation({
  args: {
    jobId: v.id('slackImportJobs'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.union(v.literal(true), v.literal(false)),
  handler: async (ctx, args) => {
    await authorize({
      userId: args.userId,
      accessToken: args.accessToken,
      serverSecret: args.serverSecret,
    })
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.userId) return false
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return false
    const now = Date.now()
    await ctx.db.patch(args.jobId, {
      status: 'cancelled',
      updatedAt: now,
      completedAt: now,
    })
    return true
  },
})
