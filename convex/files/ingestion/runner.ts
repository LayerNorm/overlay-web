import { fetchAppCallback } from '../../lib/appCallback'
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
    sourceFileId: v.optional(v.string()),
    sourceChecksumSha256: v.optional(v.string()),
    userId: v.string(),
    r2Key: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    parentId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return []
    const limit = Math.min(50, Math.max(1, args.limit ?? 10))
    const queued = await ctx.db
      .query('documentIngestionJobs')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'queued'))
      .take(limit)
    const extracting = await ctx.db
      .query('documentIngestionJobs')
      .withIndex('by_status_createdAt', (q) => q.eq('status', 'extracting'))
      .take(limit)
    const jobs = [
      ...queued,
      ...extracting.filter(job => (job.leaseExpiresAt ?? 0) <= Date.now()),
    ].slice(0, limit)
    return jobs.map((job) => ({
      _id: job._id as string,
      ...(job.sourceFileId ? { sourceFileId: job.sourceFileId as string } : {}),
      ...(job.sourceChecksumSha256 ? { sourceChecksumSha256: job.sourceChecksumSha256 } : {}),
      userId: job.userId,
      r2Key: job.r2Key,
      fileName: job.fileName,
      mimeType: job.mimeType,
      sizeBytes: job.sizeBytes,
      ...(job.parentId ? { parentId: job.parentId } : {}),
      ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
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
    attemptToken: v.string(),
    now: v.number(),
    serverSecret: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return false
    const job = await ctx.db.get(args.jobId)
    if (!job || (job.status !== 'queued' && !(job.status === 'extracting' && (job.leaseExpiresAt ?? 0) <= args.now))) return false
    if ((job.attemptCount ?? 0) >= 3) {
      await ctx.db.patch(args.jobId, {
        status: 'failed', error: 'Ingestion retry limit reached.',
        completedAt: args.now, updatedAt: args.now,
      })
      return false
    }
    await ctx.db.patch(args.jobId, {
      status: 'extracting',
      leaseToken: args.attemptToken,
      leaseExpiresAt: args.now + 5 * 60_000,
      attemptCount: (job.attemptCount ?? 0) + 1,
      updatedAt: args.now,
    })
    return true
  },
})

/**
 * Mark a job as failed (server-secret only).
 */
export const markFailed = internalMutation({
  args: {
    jobId: v.id('documentIngestionJobs'),
    error: v.string(),
    attemptToken: v.optional(v.string()),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const job = await ctx.db.get(args.jobId)
    if (!job) return null
    if (job.sourceFileId && (job.status !== 'extracting' || !args.attemptToken
      || args.attemptToken !== job.leaseToken || (job.leaseExpiresAt ?? 0) <= Date.now())) return null
    if (!job.sourceFileId && job.leaseToken && args.attemptToken !== job.leaseToken) return null
    if (job.status === 'completed' || job.status === 'failed') return null
    await ctx.db.patch(args.jobId, {
      status: 'failed',
      error: args.error,
      updatedAt: Date.now(),
      completedAt: Date.now(),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await Promise.all((jobs as any[]).map(async (job: any) => {
      const attemptToken = crypto.randomUUID()
      const claimed = await ctx.runMutation(// eslint-disable-next-line @typescript-eslint/no-explicit-any
      (internal as any).files.ingestion.runner.markExtracting, {
        jobId: job._id as Id<'documentIngestionJobs'>, attemptToken,
        now: Date.now(), serverSecret,
      })
      if (!claimed) return
      await ctx.scheduler.runAfter(0, // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (internal as any).files.ingestion.runner.processOne, {
        jobId: job._id as Id<'documentIngestionJobs'>,
        attemptToken,
        ...(job.sourceFileId ? { sourceFileId: job.sourceFileId } : {}),
        ...(job.sourceChecksumSha256 ? { sourceChecksumSha256: job.sourceChecksumSha256 } : {}),
        userId: job.userId,
        r2Key: job.r2Key,
        fileName: job.fileName,
        mimeType: job.mimeType,
        sizeBytes: job.sizeBytes,
          ...(job.parentId ? { parentId: job.parentId } : {}),
          ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
      })
    }))

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
    attemptToken: v.optional(v.string()),
    sourceFileId: v.optional(v.string()),
    sourceChecksumSha256: v.optional(v.string()),
    userId: v.string(),
    r2Key: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    parentId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const serverSecret = process.env.INTERNAL_API_SECRET ?? ''
    let attemptToken = args.attemptToken
    if (!attemptToken) {
      attemptToken = crypto.randomUUID()
      const claimed = await ctx.runMutation(// eslint-disable-next-line @typescript-eslint/no-explicit-any
        (internal as any).files.ingestion.runner.markExtracting, {
          jobId: args.jobId as Id<'documentIngestionJobs'>, attemptToken, now: Date.now(), serverSecret,
        })
      if (!claimed) return null
    }

    try {
      // Call the BFF to process the ingestion (R2 download, text extraction,
      // file record creation, and job status update).
      const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('OVERLAY_BFF_URL is not configured')
      }
      const response = await fetchAppCallback(`${baseUrl}/api/v1/files/ingest-jobs/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-secret': serverSecret,
        },
        body: JSON.stringify({
          jobId: args.jobId,
          attemptToken,
          ...(args.sourceFileId ? { sourceFileId: args.sourceFileId } : {}),
          ...(args.sourceChecksumSha256 ? { sourceChecksumSha256: args.sourceChecksumSha256 } : {}),
          userId: args.userId,
          r2Key: args.r2Key,
          fileName: args.fileName,
          mimeType: args.mimeType,
          sizeBytes: args.sizeBytes,
              ...(args.parentId ? { parentId: args.parentId } : {}),
              ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Processing failed')
        await ctx.runMutation(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).files.ingestion.runner.markFailed, {
          jobId: args.jobId,
          attemptToken,
          error: errorText.slice(0, 500),
          serverSecret,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Processing failed'
      await ctx.runMutation(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (internal as any).files.ingestion.runner.markFailed, {
        jobId: args.jobId,
        attemptToken,
        error: message.slice(0, 500),
        serverSecret,
      })
    }

    return null
  },
})
