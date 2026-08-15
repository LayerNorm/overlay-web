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

const jobPublicFields = {
  _id: v.string(),
  status: v.string(),
  selectedChannelIds: v.array(v.string()),
  totalChannels: v.optional(v.number()),
  processedChannels: v.optional(v.number()),
  totalMessages: v.optional(v.number()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
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
 * Live subscription for a single Slack import job's status.
 * The client uses this to get realtime progress updates.
 */
export const watchJob = query({
  args: {
    jobId: v.id('slackImportJobs'),
    userId: v.string(),
    accessToken: v.string(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      status: v.string(),
      selectedChannelIds: v.array(v.string()),
      totalChannels: v.optional(v.number()),
      processedChannels: v.optional(v.number()),
      totalMessages: v.optional(v.number()),
      ...coverageFields,
      error: v.optional(v.string()),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
    v.object({ ok: v.literal(false) }),
  ),
  handler: async (ctx, args) => {
    try {
      await requireAccessToken(args.accessToken, args.userId)
    } catch {
      return { ok: false as const }
    }
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.userId) return { ok: false as const }
    return {
      ok: true as const,
      status: job.status,
      selectedChannelIds: job.selectedChannelIds,
      ...(job.totalChannels !== undefined ? { totalChannels: job.totalChannels } : {}),
      ...(job.processedChannels !== undefined ? { processedChannels: job.processedChannels } : {}),
      ...(job.totalMessages !== undefined ? { totalMessages: job.totalMessages } : {}),
      ...(job.coverage ? { coverage: job.coverage } : {}),
      ...(job.error ? { error: job.error } : {}),
      updatedAt: job.updatedAt,
      ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    }
  },
})

/**
 * Live subscription for all of a user's active Slack import jobs.
 * Returns only jobs that are not yet in a terminal state.
 */
export const watchJobs = query({
  args: {
    userId: v.string(),
    accessToken: v.string(),
  },
  returns: v.array(v.object({
    ...jobPublicFields,
  })),
  handler: async (ctx, args) => {
    try {
      await requireAccessToken(args.accessToken, args.userId)
    } catch {
      return []
    }
    const jobs = await ctx.db
      .query('slackImportJobs')
      .withIndex('by_userId_status', (q) => q.eq('userId', args.userId))
      .collect()
    return jobs
      .filter((j) => j.status === 'queued' || j.status === 'listing_channels' || j.status === 'importing')
      .map((j) => ({
        _id: j._id as string,
        status: j.status,
        selectedChannelIds: j.selectedChannelIds,
        ...(j.totalChannels !== undefined ? { totalChannels: j.totalChannels } : {}),
        ...(j.processedChannels !== undefined ? { processedChannels: j.processedChannels } : {}),
        ...(j.totalMessages !== undefined ? { totalMessages: j.totalMessages } : {}),
        ...(j.error ? { error: j.error } : {}),
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
      }))
  },
})

/**
 * List Slack import jobs for a workspace (all statuses, paginated).
 */
export const listJobs = query({
  args: {
    workspaceId: v.string(),
    userId: v.string(),
    accessToken: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    ...jobPublicFields,
    ...coverageFields,
  })),
  handler: async (ctx, args) => {
    try {
      await requireAccessToken(args.accessToken, args.userId)
    } catch {
      return []
    }
    const limit = Math.min(50, Math.max(1, args.limit ?? 20))
    const jobs = await ctx.db
      .query('slackImportJobs')
      .withIndex('by_workspaceId_createdAt', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(limit)
    return jobs.map((j) => ({
      _id: j._id as string,
      status: j.status,
      selectedChannelIds: j.selectedChannelIds,
      ...(j.totalChannels !== undefined ? { totalChannels: j.totalChannels } : {}),
      ...(j.processedChannels !== undefined ? { processedChannels: j.processedChannels } : {}),
      ...(j.totalMessages !== undefined ? { totalMessages: j.totalMessages } : {}),
      ...(j.coverage ? { coverage: j.coverage } : {}),
      ...(j.error ? { error: j.error } : {}),
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      ...(j.completedAt !== undefined ? { completedAt: j.completedAt } : {}),
    }))
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

/**
 * List queued Slack import jobs for the worker to pick up (server-secret only).
 */
export const listQueuedJobs = query({
  args: {
    serverSecret: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.string(),
    userId: v.string(),
    workspaceId: v.string(),
    connectedAccountId: v.string(),
    selectedChannelIds: v.array(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return []
    const limit = Math.min(50, Math.max(1, args.limit ?? 10))
    const jobs = await ctx.db
      .query('slackImportJobs')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'queued'))
      .take(limit)
    return jobs.map((job) => ({
      _id: job._id as string,
      userId: job.userId,
      workspaceId: job.workspaceId,
      connectedAccountId: job.connectedAccountId,
      selectedChannelIds: job.selectedChannelIds,
      createdAt: job.createdAt,
    }))
  },
})
