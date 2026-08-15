import { v } from 'convex/values'
import { internalAction, internalMutation, query } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'
import type { Id } from '../_generated/dataModel'
import { internal as _internal } from '../_generated/api'
// Use any to avoid type errors before Convex codegen picks up this new file.
// The cron entry in crons.ts uses the same pattern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any

/**
 * List queued Slack import jobs that haven't been picked up yet
 * (server-secret only, called by the cron action).
 */
export const listQueuedJobsInternal = query({
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
    const limit = Math.min(10, Math.max(1, args.limit ?? 3))
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

/**
 * List stuck Slack import jobs (in 'importing' or 'listing_channels' status
 * but not updated recently — likely the worker was killed).
 */
export const listStuckJobsInternal = query({
  args: {
    serverSecret: v.string(),
    staleAfterMs: v.optional(v.number()),
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
    const limit = Math.min(10, Math.max(1, args.limit ?? 3))
    const staleAfterMs = args.staleAfterMs ?? 120_000 // 2 minutes
    const cutoff = Date.now() - staleAfterMs
    const jobs = await ctx.db
      .query('slackImportJobs')
      .withIndex('by_status_createdAt', (q) =>
        q.eq('status', 'importing')
      )
      .take(50)
    // Filter by updatedAt — Convex indexes don't support range on updatedAt
    // with the same index, so we filter in memory.
    return jobs
      .filter((j) => j.updatedAt < cutoff)
      .slice(0, limit)
      .map((job) => ({
        _id: job._id as string,
        userId: job.userId,
        workspaceId: job.workspaceId,
        connectedAccountId: job.connectedAccountId,
        selectedChannelIds: job.selectedChannelIds,
        createdAt: job.createdAt,
      }))
  },
})

/**
 * Mark a job as listing_channels (server-secret only).
 */
export const markListingChannels = internalMutation({
  args: {
    jobId: v.id('slackImportJobs'),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const job = await ctx.db.get(args.jobId)
    if (!job) return null
    await ctx.db.patch(args.jobId, {
      status: 'listing_channels',
      updatedAt: Date.now(),
    })
    return null
  },
})

/**
 * Mark a job as failed (server-secret only).
 */
export const markFailed = internalMutation({
  args: {
    jobId: v.id('slackImportJobs'),
    error: v.string(),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const job = await ctx.db.get(args.jobId)
    if (!job) return null
    await ctx.db.patch(args.jobId, {
      status: 'failed',
      error: args.error,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    })
    return null
  },
})

/**
 * Cron-triggered action that processes queued or stuck Slack import jobs.
 * For each job, it calls the BFF endpoint to run the backfill worker.
 * The BFF does the actual Slack API calls and Convex mutations.
 */
export const runMinuteTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const serverSecret = process.env.INTERNAL_API_SECRET
    if (!serverSecret) return null

    // Pick up newly queued jobs
    const queuedJobs = await ctx.runQuery(
      internal.imports.slackRunner.listQueuedJobsInternal,
      { serverSecret, limit: 3 },
    )

    // Pick up stuck jobs (importing but not updated in 2+ minutes)
    const stuckJobs = await ctx.runQuery(
      internal.imports.slackRunner.listStuckJobsInternal,
      { serverSecret, limit: 2 },
    )

    const allJobs = [...queuedJobs, ...stuckJobs]
    for (const job of allJobs) {
      await ctx.scheduler.runAfter(
        0,
        internal.imports.slackRunner.processJob,
        {
          jobId: job._id as Id<'slackImportJobs'>,
          userId: job.userId,
          workspaceId: job.workspaceId,
          connectedAccountId: job.connectedAccountId,
          selectedChannelIds: job.selectedChannelIds,
          createdAt: job.createdAt,
        },
      )
    }

    return null
  },
})

/**
 * Process a single Slack import job by calling the BFF backfill endpoint.
 * The BFF runs the full backfill worker (fetch users, import channels,
 * fetch messages, threads, files) and updates job status in Convex.
 */
export const processJob = internalAction({
  args: {
    jobId: v.id('slackImportJobs'),
    userId: v.string(),
    workspaceId: v.string(),
    connectedAccountId: v.string(),
    selectedChannelIds: v.array(v.string()),
    createdAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const serverSecret = process.env.INTERNAL_API_SECRET ?? ''

    // Mark as listing_channels so it's no longer "queued"
    await ctx.runMutation(internal.imports.slackRunner.markListingChannels, {
      jobId: args.jobId,
      serverSecret,
    })

    try {
      const baseUrl = process.env.OVERLAY_BFF_URL ?? 'http://localhost:3000'
      const response = await fetch(`${baseUrl}/api/v1/imports/slack/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-secret': serverSecret,
        },
        body: JSON.stringify({
          jobId: args.jobId,
          userId: args.userId,
          workspaceId: args.workspaceId,
          connectedAccountId: args.connectedAccountId,
          selectedChannelIds: args.selectedChannelIds,
          createdAt: args.createdAt,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Processing failed')
        await ctx.runMutation(internal.imports.slackRunner.markFailed, {
          jobId: args.jobId,
          error: errorText.slice(0, 500),
          serverSecret,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Processing failed'
      await ctx.runMutation(internal.imports.slackRunner.markFailed, {
        jobId: args.jobId,
        error: message.slice(0, 500),
        serverSecret,
      })
    }

    return null
  },
})
