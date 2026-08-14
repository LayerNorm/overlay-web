import { v } from 'convex/values'
import { mutation, query } from '../../_generated/server'
import { requireAccessToken, validateServerSecret } from '../../lib/auth'

async function authorize(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) return
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

/**
 * Create a document ingestion job after the client has uploaded the file
 * directly to R2 via a presigned URL. The job is processed asynchronously
 * by the server, and the client subscribes to status updates via
 * watchIngestionJob or watchIngestionJobs.
 */
export const createJob = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    r2Key: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    projectId: v.optional(v.string()),
    parentId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.object({
    jobId: v.string(),
  }),
  handler: async (ctx, args) => {
    await authorize({ userId: args.userId, serverSecret: args.serverSecret })
    const now = Date.now()
    const jobId = await ctx.db.insert('documentIngestionJobs', {
      userId: args.userId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
      r2Key: args.r2Key,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(args.parentId ? { parentId: args.parentId } : {}),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    return { jobId: jobId as string }
  },
})

/**
 * Get a single ingestion job by ID.
 */
export const getJob = query({
  args: {
    jobId: v.id('documentIngestionJobs'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      _id: v.string(),
      status: v.string(),
      statusMessage: v.optional(v.string()),
      fileName: v.string(),
      partCount: v.optional(v.number()),
      fileIds: v.optional(v.array(v.string())),
      error: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    try {
      await authorize({ userId: args.userId, accessToken: args.accessToken, serverSecret: args.serverSecret })
    } catch {
      return null
    }
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.userId) return null
    return {
      _id: job._id as string,
      status: job.status,
      ...(job.statusMessage ? { statusMessage: job.statusMessage } : {}),
      fileName: job.fileName,
      ...(job.partCount !== undefined ? { partCount: job.partCount } : {}),
      ...(job.fileIds ? { fileIds: job.fileIds.map((id) => id as string) } : {}),
      ...(job.error ? { error: job.error } : {}),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    }
  },
})

/**
 * Live subscription for a single ingestion job's status.
 * The client uses this to get realtime updates as the job progresses
 * through queued → extracting → indexing → completed/failed.
 */
export const watchIngestionJob = query({
  args: {
    jobId: v.id('documentIngestionJobs'),
    userId: v.string(),
    accessToken: v.string(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      status: v.string(),
      statusMessage: v.optional(v.string()),
      fileName: v.string(),
      partCount: v.optional(v.number()),
      fileIds: v.optional(v.array(v.string())),
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
      ...(job.statusMessage ? { statusMessage: job.statusMessage } : {}),
      fileName: job.fileName,
      ...(job.partCount !== undefined ? { partCount: job.partCount } : {}),
      ...(job.fileIds ? { fileIds: job.fileIds.map((id) => id as string) } : {}),
      ...(job.error ? { error: job.error } : {}),
      updatedAt: job.updatedAt,
      ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    }
  },
})

/**
 * Live subscription for all of a user's active ingestion jobs.
 * Returns only jobs that are not yet in a terminal state.
 */
export const watchIngestionJobs = query({
  args: {
    userId: v.string(),
    accessToken: v.string(),
  },
  returns: v.array(v.object({
    _id: v.string(),
    status: v.string(),
    statusMessage: v.optional(v.string()),
    fileName: v.string(),
    partCount: v.optional(v.number()),
    fileIds: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    try {
      await requireAccessToken(args.accessToken, args.userId)
    } catch {
      return []
    }
    const active = await ctx.db
      .query('documentIngestionJobs')
      .withIndex('by_userId_status', (q) => q.eq('userId', args.userId))
      .collect()
    return active
      .filter((job) => job.status === 'queued' || job.status === 'extracting' || job.status === 'indexing')
      .map((job) => ({
        _id: job._id as string,
        status: job.status,
        ...(job.statusMessage ? { statusMessage: job.statusMessage } : {}),
        fileName: job.fileName,
        ...(job.partCount !== undefined ? { partCount: job.partCount } : {}),
        ...(job.fileIds ? { fileIds: job.fileIds.map((id) => id as string) } : {}),
        ...(job.error ? { error: job.error } : {}),
        updatedAt: job.updatedAt,
      }))
  },
})

/**
 * Update job status (server-secret only, called by the ingestion worker).
 */
export const updateJobStatus = mutation({
  args: {
    jobId: v.id('documentIngestionJobs'),
    userId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('extracting'),
      v.literal('indexing'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    statusMessage: v.optional(v.string()),
    fileIds: v.optional(v.array(v.id('files'))),
    partCount: v.optional(v.number()),
    error: v.optional(v.string()),
    serverSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) {
      throw new Error('Unauthorized')
    }
    const job = await ctx.db.get(args.jobId)
    if (!job || job.userId !== args.userId) throw new Error('Job not found')
    const now = Date.now()
    await ctx.db.patch(args.jobId, {
      status: args.status,
      updatedAt: now,
      ...(args.statusMessage !== undefined ? { statusMessage: args.statusMessage } : {}),
      ...(args.fileIds !== undefined ? { fileIds: args.fileIds } : {}),
      ...(args.partCount !== undefined ? { partCount: args.partCount } : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
      ...((args.status === 'completed' || args.status === 'failed') ? { completedAt: now } : {}),
    })
    return null
  },
})

/**
 * List jobs that are queued for processing (server-secret only, called by
 * the ingestion worker to find work).
 */
export const listQueuedJobs = query({
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
