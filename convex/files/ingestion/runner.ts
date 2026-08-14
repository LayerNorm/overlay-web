import { v } from 'convex/values'
import { internal } from '../../_generated/api'
import { internalAction, internalMutation, query } from '../../_generated/server'
import { validateServerSecret } from '../../lib/auth'
import type { Id } from '../../_generated/dataModel'

/**
 * List queued ingestion jobs (server-secret only).
 */
export const listQueuedJobsInternal = query({
  args: {
    serverSecret: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.string(),
    userId: v.string(),
    r2Key: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    projectId: v.optional(v.string()),
    parentId: v.optional(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return []
    const limit = Math.min(50, Math.max(1, args.limit ?? 10))
    const jobs = await ctx.db
      .query('documentIngestionJobs')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'queued'))
      .take(limit)
    return jobs.map((job) => ({
      _id: job._id as string,
      userId: job.userId,
      r2Key: job.r2Key,
      fileName: job.fileName,
      mimeType: job.mimeType,
      sizeBytes: job.sizeBytes,
      ...(job.projectId ? { projectId: job.projectId } : {}),
      ...(job.parentId ? { parentId: job.parentId } : {}),
      createdAt: job.createdAt,
    }))
  },
})

/**
 * Mark a job as extracting (server-secret only).
 */
export const markExtracting = internalMutation({
  args: {
    jobId: v.id('documentIngestionJobs'),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const job = await ctx.db.get(args.jobId)
    if (!job) return null
    await ctx.db.patch(args.jobId, {
      status: 'extracting',
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
    jobId: v.id('documentIngestionJobs'),
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
 * Cron-triggered action that processes queued document ingestion jobs.
 * For each queued job, it schedules a processOne action that calls the
 * BFF to download from R2, extract text, and create file records.
 */
export const runMinuteTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const serverSecret = process.env.INTERNAL_API_SECRET
    if (!serverSecret) return null

    const jobs = await ctx.runQuery(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).files.ingestion.runner.listQueuedJobsInternal, {
      serverSecret,
      limit: 5,
    })

    for (const job of jobs) {
      await ctx.scheduler.runAfter(0, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).files.ingestion.runner.processOne, {
        jobId: job._id as Id<'documentIngestionJobs'>,
        userId: job.userId,
        r2Key: job.r2Key,
        fileName: job.fileName,
        mimeType: job.mimeType,
        sizeBytes: job.sizeBytes,
        ...(job.projectId ? { projectId: job.projectId } : {}),
        ...(job.parentId ? { parentId: job.parentId } : {}),
      })
    }

    return null
  },
})

/**
 * Process a single ingestion job by calling the BFF processing endpoint.
 * The BFF handles R2 download, text extraction, and file record creation.
 */
export const processOne = internalAction({
  args: {
    jobId: v.id('documentIngestionJobs'),
    userId: v.string(),
    r2Key: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    projectId: v.optional(v.string()),
    parentId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const serverSecret = process.env.INTERNAL_API_SECRET ?? ''

    // Mark as extracting
    await ctx.runMutation(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).files.ingestion.runner.markExtracting, {
      jobId: args.jobId,
      serverSecret,
    })

    try {
      // Call the BFF to process the ingestion (R2 download, text extraction,
      // file record creation, and job status update).
      const baseUrl = process.env.OVERLAY_BFF_URL ?? 'http://localhost:3000'
      const response = await fetch(`${baseUrl}/api/v1/files/ingest-jobs/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-secret': serverSecret,
        },
        body: JSON.stringify({
          jobId: args.jobId,
          userId: args.userId,
          r2Key: args.r2Key,
          fileName: args.fileName,
          mimeType: args.mimeType,
          sizeBytes: args.sizeBytes,
          ...(args.projectId ? { projectId: args.projectId } : {}),
          ...(args.parentId ? { parentId: args.parentId } : {}),
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Processing failed')
        await ctx.runMutation(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).files.ingestion.runner.markFailed, {
          jobId: args.jobId,
          error: errorText.slice(0, 500),
          serverSecret,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Processing failed'
      await ctx.runMutation(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).files.ingestion.runner.markFailed, {
        jobId: args.jobId,
        error: message.slice(0, 500),
        serverSecret,
      })
    }

    return null
  },
})
